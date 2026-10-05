import { useEffect, useState } from 'react';
import { Trans } from 'react-i18next';
import { Button, OGDialog, OGDialogTrigger, OGDialogTemplate } from '@librechat/client';
import type { ReactNode } from 'react';
import { useCreditRequestStatus, useLocalize } from '~/hooks';
import { cn } from '~/utils';

/** Re-render every minute so the "refills in X" countdown stays live without
 *  a per-second timer — minute-level precision matches what's actually shown. */
const COUNTDOWN_TICK_MS = 60_000;
/** Below this fraction of the configured refill allocation, warn before the
 *  user actually hits zero. */
const LOW_BALANCE_THRESHOLD = 0.2;

/** Exclamation-in-a-circle glyph used for both severity states. */
function AlertIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="8" cy="8" r="6.25" stroke="currentColor" strokeWidth="1.6" />
      <path d="M8 4.75v3.75" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="8" cy="11.1" r="0.9" fill="currentColor" />
    </svg>
  );
}

/** Clock glyph used once a reset has been requested and is awaiting approval. */
function ClockIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="8" cy="8" r="6.25" stroke="currentColor" strokeWidth="1.7" />
      <path
        d="M8 4.75V8l2.25 1.5"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function useCountdownTick(active: boolean): void {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!active) {
      return;
    }
    const interval = setInterval(() => setTick((t) => t + 1), COUNTDOWN_TICK_MS);
    return () => clearInterval(interval);
  }, [active]);
}

function useFormattedCountdown(nextRefillAt: Date | undefined): string | undefined {
  const localize = useLocalize();
  useCountdownTick(nextRefillAt != null);

  if (!nextRefillAt) {
    return undefined;
  }
  const msRemaining = nextRefillAt.getTime() - Date.now();
  const totalMinutes = Math.max(0, Math.round(msRemaining / 60_000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) {
    return localize('com_nav_balance_refill_countdown_hm', { hours, minutes });
  }
  return localize('com_nav_balance_refill_countdown_m', { minutes });
}

export default function OutOfCreditNotice() {
  const localize = useLocalize();
  const {
    enabled,
    isLoading,
    tokenCredits,
    refillAmount,
    nextRefillAt,
    pendingCreditRequest,
    submit,
    isSubmitting,
  } = useCreditRequestStatus();
  const duration = useFormattedCountdown(nextRefillAt);
  const [reason, setReason] = useState('');

  const isOutOfCredits = tokenCredits <= 0;
  const isLowBalance =
    !isOutOfCredits &&
    refillAmount != null &&
    refillAmount > 0 &&
    tokenCredits < refillAmount * LOW_BALANCE_THRESHOLD;

  // `enabled`/`isLoading` are required, not just `tokenCredits <= 0` — a
  // deployment with balance disabled, or a query that simply hasn't resolved
  // yet, both leave `tokenCredits` at its 0 default, which is indistinguishable
  // from a genuinely exhausted balance unless checked explicitly.
  if (!enabled || isLoading || (!isOutOfCredits && !isLowBalance)) {
    return null;
  }

  let title: string;
  let subtitle: ReactNode;
  let iconClassName: string;
  if (pendingCreditRequest) {
    title = localize('com_nav_balance_reset_requested_title');
    subtitle = duration ? (
      <Trans
        i18nKey="com_nav_balance_reset_requested_subtitle"
        values={{ duration }}
        components={{ strong: <strong /> }}
      />
    ) : (
      localize('com_nav_balance_reset_requested_subtitle_no_refill')
    );
    iconClassName = 'bg-[#ececec] text-[#424242] dark:bg-gray-600 dark:text-gray-200';
  } else if (isOutOfCredits) {
    title = localize('com_nav_balance_out_of_credit_title');
    subtitle = duration ? (
      <Trans
        i18nKey="com_nav_balance_out_of_credit_subtitle"
        values={{ duration }}
        components={{ strong: <strong /> }}
      />
    ) : undefined;
    iconClassName = 'bg-gray-900 text-white dark:bg-white dark:text-gray-900';
  } else {
    title = localize('com_nav_balance_running_low_title');
    const credits = tokenCredits.toLocaleString();
    subtitle = duration ? (
      <Trans
        i18nKey="com_nav_balance_running_low_subtitle"
        values={{ credits, duration }}
        components={{ strong: <strong /> }}
      />
    ) : (
      <Trans
        i18nKey="com_nav_balance_running_low_subtitle_no_refill"
        values={{ credits }}
        components={{ strong: <strong /> }}
      />
    );
    iconClassName =
      'bg-[oklch(0.94_0.05_75)] text-[oklch(0.52_0.12_70)] dark:bg-amber-500/15 dark:text-amber-400';
  }

  // Pending reuses the same muted row background as the out-of-credits
  // (blocking) state — only the "available, low-balance" row stays on a
  // plain white/card background.
  const rowBg =
    pendingCreditRequest || isOutOfCredits
      ? 'bg-[#f7f7f8] dark:bg-surface-tertiary'
      : 'bg-white dark:bg-surface-primary';

  const percentRemaining =
    isLowBalance && !pendingCreditRequest && refillAmount
      ? Math.min(100, Math.max(0, (tokenCredits / refillAmount) * 100))
      : null;

  return (
    <div className="mx-auto mb-3 flex w-full max-w-3xl flex-col sm:px-2 xl:max-w-4xl">
      <div
        className={cn(
          'flex items-center justify-between gap-3 rounded-2xl border border-border-light px-3.5 py-3',
          rowBg,
        )}
      >
        <div className="flex min-w-0 items-center gap-3">
          <span
            className={cn(
              'flex size-8 shrink-0 items-center justify-center rounded-full',
              iconClassName,
            )}
          >
            {pendingCreditRequest ? (
              <ClockIcon className="size-4" />
            ) : (
              <AlertIcon className="size-4" />
            )}
          </span>
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="text-sm font-semibold text-text-primary">{title}</span>
            {subtitle && <span className="text-sm text-text-secondary">{subtitle}</span>}
            {percentRemaining != null && (
              <div
                role="meter"
                aria-label={localize('com_nav_balance_running_low_title')}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(percentRemaining)}
                className="mt-1 h-1 w-40 overflow-hidden rounded-full bg-black/10 dark:bg-white/10"
              >
                <div
                  className="h-full rounded-full bg-[oklch(0.72_0.14_70)] transition-[width]"
                  style={{ width: `${percentRemaining}%` }}
                />
              </div>
            )}
          </div>
        </div>
        {pendingCreditRequest ? (
          <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-[#ececec] px-3 py-2 text-sm font-medium text-[#424242] dark:bg-gray-600 dark:text-gray-200">
            <ClockIcon className="size-3.5" />
            {localize('com_nav_balance_pending_pill')}
          </span>
        ) : (
          <OGDialog>
            <OGDialogTrigger asChild>
              <Button
                size="sm"
                variant="outline"
                type="button"
                className={cn(
                  'shrink-0 rounded-full',
                  isOutOfCredits &&
                    'border-transparent bg-gray-900 text-white hover:bg-gray-800 hover:text-white dark:bg-white dark:text-gray-900 dark:hover:bg-gray-200 dark:hover:text-gray-900',
                )}
              >
                {localize('com_nav_balance_request_reset_button')}
              </Button>
            </OGDialogTrigger>
            <OGDialogTemplate
              title={localize('com_nav_balance_reset_dialog_title')}
              description={localize('com_nav_balance_reset_dialog_description')}
              className="max-w-[450px]"
              main={
                <div className="flex w-full flex-col gap-2">
                  <label
                    htmlFor="reset-credit-reason"
                    className="text-left text-sm font-medium text-text-primary"
                  >
                    {localize('com_nav_balance_request_reason_label')}
                  </label>
                  <textarea
                    id="reset-credit-reason"
                    className="w-full rounded-xl border border-border-light bg-transparent p-2 text-text-primary"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    rows={4}
                    maxLength={500}
                    placeholder={localize('com_nav_balance_reset_reason_placeholder')}
                  />
                </div>
              }
              selection={{
                selectHandler: () => submit(reason.trim() || undefined),
                selectText: localize('com_nav_balance_send_request_button'),
                isLoading: isSubmitting,
              }}
            />
          </OGDialog>
        )}
      </div>
    </div>
  );
}
