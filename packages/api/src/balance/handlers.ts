import type { IBalance, IBalanceRequest, AppConfig } from '@librechat/data-schemas';
import type { Response } from 'express';
import type { GetAppConfigOptions } from '~/app/service';
import type { ServerRequest } from '~/types/http';
import { getBalanceConfig } from '~/app/config';

/** Reason is user-supplied free text — clamp it before it ever reaches the DB. */
const MAX_REASON_LENGTH = 500;

/** Mirrors the (unexported) `BalanceLocals` shape set by `createSetBalanceConfig`
 * in `middleware/balance.ts` — `getBalance` reads what that middleware already
 * resolved instead of re-fetching when possible. */
type BalanceLocals = {
  balanceData?: IBalance | null;
  balanceConfigEnabled?: boolean;
};

export interface BalanceDeps {
  findBalanceByUser: (user: string) => Promise<IBalance | null>;
  findPendingBalanceRequestByUser: (userId: string) => Promise<IBalanceRequest | null>;
  createBalanceRequest: (userId: string, reason?: string) => Promise<IBalanceRequest>;
  getAppConfig: (options?: GetAppConfigOptions) => Promise<AppConfig>;
  /** Applies an overdue auto-refill if one is due, atomically — same CAS-based
   *  transaction the message-send path and admin-resolution path already
   *  share, so a balance poll can never double-refill alongside either of
   *  those. See `packages/data-schemas/src/methods/transaction.ts`. */
  maybeApplyAutoRefill: (user: string, currentBalance: number) => Promise<number>;
}

export function createBalanceHandlers(deps: BalanceDeps): {
  getBalance: (req: ServerRequest, res: Response) => Promise<Response>;
  requestTopUp: (req: ServerRequest, res: Response) => Promise<Response>;
} {
  const {
    findBalanceByUser,
    findPendingBalanceRequestByUser,
    createBalanceRequest,
    getAppConfig,
    maybeApplyAutoRefill,
  } = deps;

  async function getBalanceHandler(req: ServerRequest, res: Response) {
    const balanceLocals = (res.locals ?? {}) as BalanceLocals;

    if (balanceLocals.balanceConfigEnabled === false) {
      return res.sendStatus(204);
    }

    const userId = req.user?.id as string;
    let balanceData = balanceLocals.balanceData ?? (await findBalanceByUser(userId));

    if (!balanceData) {
      return res.status(404).json({ error: 'Balance not found' });
    }

    // Resolve the live effective config first — same as `requestTopUpHandler`
    // — `autoRefillEnabled`/`refillAmount`/interval fields stored on the
    // Balance document are only ever backfilled once, the first time it was
    // lazily created while auto-refill happened to already be on in config.
    // `createSetBalanceConfig` (middleware/balance.ts) only ever fills gaps
    // in on the stored document — it never retracts a previously-stored
    // `autoRefillEnabled: true` back to `false` once an admin disables it
    // live. The live config must take priority (same bug/fix as the admin
    // Balance list's `resolveBalanceConfig`) and — critically — must be
    // resolved *before* `maybeApplyAutoRefill` below, which only ever
    // consults the persisted document: checking it after would still let a
    // stale `autoRefillEnabled: true` apply an unauthorized refill just from
    // loading this page, even though the response correctly reports refill
    // as off.
    const appConfig = await getAppConfig({
      role: req.user?.role,
      userId,
      tenantId: req.user?.tenantId,
    });
    const balanceConfig = getBalanceConfig(appConfig);
    const autoRefillEnabled =
      balanceConfig?.autoRefillEnabled ?? balanceData.autoRefillEnabled ?? false;
    const refillAmount = balanceConfig?.refillAmount ?? balanceData.refillAmount;

    // The stored balance is only ever refreshed lazily, as a side effect of
    // the next message send (`checkBalance` middleware) — a user who goes
    // idle right as their refill becomes due would otherwise see a stale
    // zero balance here indefinitely, with the countdown banner implying a
    // refresh that never actually happens until they send another message.
    // Re-checking eligibility on every balance read closes that gap; the
    // underlying transaction is the same atomic claim, so concurrent reads,
    // sends, and admin resolutions can't double-refill each other. Gated on
    // the live-resolved `autoRefillEnabled` above, not the raw document.
    if (autoRefillEnabled) {
      const refreshedBalance = await maybeApplyAutoRefill(userId, balanceData.tokenCredits);
      if (refreshedBalance !== balanceData.tokenCredits) {
        balanceData = (await findBalanceByUser(userId)) ?? balanceData;
      }
    }

    // Explicit public-field whitelist — never spread `balanceData` directly.
    // It's a raw Balance document, which also carries internal-only fields
    // (`user`, `tenantId`, and `recentIdempotencyKeys` — the admin-credit
    // idempotency ring buffer from `applyIdempotentCredit` — none of which
    // belong in a response a browser can read) alongside the ones actually
    // declared on `TBalanceResponse`.
    const responseBody: Record<string, unknown> = {
      tokenCredits: balanceData.tokenCredits,
      autoRefillEnabled,
    };
    // Independent of `autoRefillEnabled` — the client needs the configured
    // allocation size to show a "running low" warning relative to it even
    // when automatic refilling itself is off.
    if (refillAmount != null) {
      responseBody.refillAmount = refillAmount;
    }
    if (autoRefillEnabled) {
      responseBody.refillIntervalValue =
        balanceConfig?.refillIntervalValue ?? balanceData.refillIntervalValue;
      responseBody.refillIntervalUnit =
        balanceConfig?.refillIntervalUnit ?? balanceData.refillIntervalUnit;
      responseBody.lastRefill = balanceData.lastRefill;
    }

    const pending = await findPendingBalanceRequestByUser(userId);
    if (pending) {
      responseBody.pendingCreditRequest = {
        requestId: pending._id.toString(),
        requestedAt: pending.requestedAt.toISOString(),
        reason: pending.reason,
      };
    }

    return res.status(200).json(responseBody);
  }

  async function requestTopUpHandler(req: ServerRequest, res: Response) {
    const userId = req.user?.id as string;
    const { reason } = (req.body ?? {}) as { reason?: unknown };
    const trimmedReason =
      typeof reason === 'string' && reason.trim().length > 0
        ? reason.trim().slice(0, MAX_REASON_LENGTH)
        : undefined;

    const appConfig = await getAppConfig({
      role: req.user?.role,
      userId,
      tenantId: req.user?.tenantId,
    });
    const balanceConfig = getBalanceConfig(appConfig);
    if (!balanceConfig?.enabled) {
      return res.status(400).json({ error: 'Balance is not enabled' });
    }

    const request = await createBalanceRequest(userId, trimmedReason);

    return res.status(200).json({
      requestId: request._id.toString(),
      requestedAt: request.requestedAt.toISOString(),
      reason: request.reason,
    });
  }

  return {
    getBalance: getBalanceHandler,
    requestTopUp: requestTopUpHandler,
  };
}
