import { useEffect, useState } from 'react';
import { useToastContext } from '@librechat/client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  QueryKeys,
  MutationKeys,
  dataService,
  getRefillEligibilityDate,
} from 'librechat-data-provider';
import { useGetStartupConfig, useGetUserBalance } from '~/data-provider';
import { useAuthContext, useLocalize } from '~/hooks';

/** Below the ~24.8-day signed-32-bit `setTimeout` delay limit — a monthly
 *  refill interval would otherwise silently fire almost immediately instead
 *  of overflowing, so long waits are broken into re-checks capped at this. */
const MAX_SCHEDULE_DELAY_MS = 24 * 60 * 60 * 1000;
/** Backoff schedule for retrying a deadline that fired but didn't move
 *  `lastRefill` — lease contention with an admin, a concurrent refill still
 *  completing, or a caught DB error inside `maybeApplyAutoRefill` can all
 *  return the balance unchanged. Bounded, not indefinite: a persistently
 *  non-refillable account (e.g. a misconfigured zero `refillAmount`) must
 *  not be polled forever. */
const RETRY_DELAYS_MS = [5_000, 15_000, 30_000, 60_000, 120_000, 300_000];

/**
 * Single source of truth for "does the current user have a pending
 * request for more credits" — shared by the Settings button and the
 * out-of-credit chat banner so submitting from one is immediately
 * reflected in the other.
 */
export default function useCreditRequestStatus(): {
  /** Whether the balance feature is on for this deployment at all — callers
   * that gate visibility on running out of credit (e.g. the chat banner)
   * must check this, since `tokenCredits` defaults to 0 whether balance is
   * genuinely zero, disabled, or just not loaded yet, and those are not the
   * same thing. */
  enabled: boolean;
  /** True until the balance query has actually resolved (or the feature is
   * disabled/the user isn't authenticated, in which case it never will) —
   * distinguishes "still finding out" from "confirmed zero." */
  isLoading: boolean;
  tokenCredits: number;
  /** The user's configured auto-refill allocation size, if any — present
   *  independent of whether auto-refill itself is on, used for a "running
   *  low" threshold relative to it. */
  refillAmount: number | undefined;
  /** When auto-refill is on and enough data is present to compute it, the
   *  next moment this user becomes eligible for an automatic refill. */
  nextRefillAt: Date | undefined;
  /** True once an exhausted balance has reached its automatic-refill
   *  deadline. The chat notice uses this to disappear immediately rather
   *  than briefly offering an unnecessary manual reset while the confirmed
   *  balance refresh is in flight. */
  isAutoRefillDue: boolean;
  pendingCreditRequest:
    | { requestId: string; requestedAt: Date | string; reason?: string }
    | undefined;
  submit: (reason?: string) => void;
  isSubmitting: boolean;
} {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const queryClient = useQueryClient();
  const { isAuthenticated } = useAuthContext();
  const { data: startupConfig } = useGetStartupConfig();

  const enabled = !!isAuthenticated && !!startupConfig?.balance?.enabled;
  const balanceQuery = useGetUserBalance({ enabled });

  const balanceData = balanceQuery.data;
  const tokenCredits = balanceData?.tokenCredits ?? 0;
  const nextRefillAt =
    balanceData?.autoRefillEnabled &&
    balanceData.lastRefill != null &&
    balanceData.refillIntervalValue != null &&
    balanceData.refillIntervalUnit != null
      ? getRefillEligibilityDate(
          new Date(balanceData.lastRefill),
          balanceData.refillIntervalValue,
          balanceData.refillIntervalUnit,
        )
      : undefined;
  const nextRefillAtMs = nextRefillAt?.getTime();
  const [reachedRefillDeadline, setReachedRefillDeadline] = useState<number>();
  const isAutoRefillDue =
    tokenCredits <= 0 &&
    nextRefillAtMs != null &&
    (nextRefillAtMs <= Date.now() || reachedRefillDeadline === nextRefillAtMs);

  // `useGetUserBalance` only refetches on window focus/reconnect/mount —
  // a tab left open and idle past the refill moment would otherwise show
  // a stale "0 min" countdown indefinitely instead of ever picking up the
  // (now eligible) refill. Invalidating re-triggers `GET /api/balance`,
  // which applies the refill atomically before responding. The deadline
  // state also suppresses the now-obsolete manual-reset notice immediately;
  // the balance itself remains unchanged until the server confirms credit.
  //
  // Gated on `tokenCredits <= 0`: `maybeApplyAutoRefill` (server-side)
  // short-circuits whenever the balance is still positive, leaving
  // `lastRefill` — and so `nextRefillAt` — untouched on purpose. Without
  // this gate, every auto-refill user with credit still left would run
  // the full retry chain on every mount once their interval merely
  // elapses, for a refill the backend was never going to apply.
  useEffect(() => {
    if (!nextRefillAt || tokenCredits > 0) {
      return;
    }
    let timeoutId: ReturnType<typeof setTimeout>;
    let retryAttempt = 0;
    const checkDeadline = () => {
      const msRemaining = nextRefillAt.getTime() - Date.now();
      if (msRemaining > 0) {
        timeoutId = setTimeout(checkDeadline, Math.min(msRemaining, MAX_SCHEDULE_DELAY_MS));
        return;
      }

      setReachedRefillDeadline(nextRefillAt.getTime());
      queryClient.invalidateQueries([QueryKeys.balance]);

      // The refetch above may resolve without moving `lastRefill` at all
      // (see `RETRY_DELAYS_MS`'s doc comment) — `nextRefillAt`'s own
      // identity wouldn't change in that case, so nothing would otherwise
      // re-trigger this effect. Retry with backoff instead of leaving a
      // confirmed-overdue banner stuck until some unrelated refetch
      // (window focus, mount, a message send) happens to come along. If
      // the refill does land, `nextRefillAt` moves to a future date, this
      // effect re-runs for that new deadline, and this retry chain is
      // abandoned by the cleanup below.
      if (retryAttempt < RETRY_DELAYS_MS.length) {
        timeoutId = setTimeout(checkDeadline, RETRY_DELAYS_MS[retryAttempt]);
        retryAttempt += 1;
      }
    };
    checkDeadline();
    return () => clearTimeout(timeoutId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nextRefillAt?.getTime(), tokenCredits, queryClient]);

  const mutation = useMutation([MutationKeys.requestCredits], {
    mutationFn: (reason?: string) => dataService.requestBalanceTopUp({ reason }),
    onSuccess: () => {
      queryClient.invalidateQueries([QueryKeys.balance]);
      showToast({
        message: localize('com_nav_balance_request_success_toast'),
        status: 'success',
      });
    },
    onError: () => {
      showToast({
        message: localize('com_nav_balance_request_error_toast'),
        status: 'error',
      });
    },
  });

  return {
    enabled,
    isLoading: enabled && balanceQuery.data == null,
    tokenCredits,
    refillAmount: balanceData?.refillAmount,
    nextRefillAt,
    isAutoRefillDue,
    pendingCreditRequest: balanceQuery.data?.pendingCreditRequest,
    submit: (reason?: string) => mutation.mutate(reason),
    isSubmitting: mutation.isLoading,
  };
}
