import { getRefillEligibilityDate } from 'librechat-data-provider';
import type { FilterQuery, Model, Types } from 'mongoose';
import type { IBalance, IBalanceRequest, IBalanceUpdate, TransactionData } from '~/types';
import type { ITransaction } from '~/schema/transaction';
import { getTenantId, SYSTEM_TENANT_ID } from '~/config/tenantContext';
import { supportsTransactions } from '~/utils/transactions';
import logger from '~/config/winston';

const cancelRate = 1.15;

type MultiplierParams = {
  model?: string;
  valueKey?: string;
  tokenType?: 'prompt' | 'completion';
  inputTokenCount?: number;
  endpointTokenConfig?: Record<string, Record<string, number>>;
};

type CacheMultiplierParams = {
  cacheType?: 'write' | 'read';
  model?: string;
  endpointTokenConfig?: Record<string, Record<string, number>>;
  inputTokenCount?: number;
};

/** Fields read/written by the internal token value calculators */
interface InternalTxDoc {
  valueKey?: string;
  tokenType?: 'prompt' | 'completion' | 'credits';
  model?: string;
  endpointTokenConfig?: Record<string, Record<string, number>> | null;
  inputTokenCount?: number;
  rawAmount?: number;
  context?: string;
  rate?: number;
  tokenValue?: number;
  rateDetail?: Record<string, number>;
  inputTokens?: number;
  writeTokens?: number;
  readTokens?: number;
}

/** Input data for creating a transaction */
export interface TxData {
  user: string | Types.ObjectId;
  conversationId?: string;
  model?: string;
  context?: string;
  tokenType?: 'prompt' | 'completion' | 'credits';
  rawAmount?: number;
  valueKey?: string;
  endpointTokenConfig?: Record<string, Record<string, number>> | null;
  inputTokenCount?: number;
  inputTokens?: number;
  writeTokens?: number;
  readTokens?: number;
  balance?: { enabled?: boolean };
  transactions?: { enabled?: boolean };
  /** Denormalized traceability field for admin-credit ledger rows; see `applyIdempotentCredit`. */
  idempotencyKey?: string;
}

/** Return value from a successful transaction that also updates the balance */
export interface TransactionResult {
  rate: number;
  user: string;
  balance: number;
  prompt?: number;
  completion?: number;
  credits?: number;
}

export function createTransactionMethods(
  mongoose: typeof import('mongoose'),
  txMethods: {
    getMultiplier: (params: MultiplierParams) => number;
    getCacheMultiplier: (params: CacheMultiplierParams) => number | null;
    /** Finds a user's pending balance request, if any — lets auto-refill
     *  detect whether an admin could be actively fulfilling the same
     *  shortage before crediting. Optional so tests exercising unrelated
     *  transaction paths don't need to wire up balance-request methods. */
    findPendingBalanceRequestByUser?: (userId: string) => Promise<IBalanceRequest | null>;
    /** Same claim admin's `addCreditHandler` takes before crediting — shared
     *  here so auto-refill and an admin can never both credit the same
     *  pending request's shortage. */
    claimBalanceRequestResolution?: (requestId: string, userId: string) => Promise<boolean>;
    releaseBalanceRequestResolutionLease?: (requestId: string) => Promise<void>;
    /** Resolves the specific request this call already claimed — no
     *  `resolvedBy`, since auto-refill is system-driven, not an admin. */
    resolveBalanceRequestIfPending?: (
      requestId: string,
      userId: string,
      fields: { resolvedAmount: number },
    ) => Promise<unknown>;
  },
): {
  updateBalance: ({
    user,
    incrementValue,
    setValues,
  }: {
    user: string;
    incrementValue: number;
    setValues?: IBalanceUpdate;
  }) => Promise<IBalance>;
  bulkInsertTransactions: (docs: TransactionData[]) => Promise<void>;
  findBalanceByUser: (user: string) => Promise<IBalance | null>;
  findBalancesByUsers: (userIds: string[]) => Promise<IBalance[]>;
  upsertBalanceFields: (user: string, fields: IBalanceUpdate) => Promise<IBalance | null>;
  applyIdempotentCredit: (params: {
    user: string;
    incrementValue: number;
    idempotencyKey: string;
    context: string;
  }) => Promise<{ resultingBalance: number; applied: boolean; transactionId: string }>;
  claimAuditRecording: (transactionId: string, leaseMs?: number) => Promise<boolean>;
  markAuditRecorded: (transactionId: string) => Promise<void>;
  releaseAuditRecordingLease: (transactionId: string) => Promise<void>;
  ensureTransactionIdempotencyIndex: () => Promise<void>;
  getTransactions: (filter: FilterQuery<ITransaction>) => Promise<ITransaction[]>;
  deleteTransactions: (
    filter: FilterQuery<ITransaction>,
  ) => Promise<import('mongodb').DeleteResult>;
  deleteBalances: (filter: FilterQuery<IBalance>) => Promise<import('mongodb').DeleteResult>;
  createTransaction: (_txData: TxData) => Promise<TransactionResult | undefined>;
  createAutoRefillTransaction: (
    txData: TxData,
    expectedLastRefill: Date | null,
  ) => Promise<
    | {
        rate: number;
        user: string;
        balance: number;
        transaction: ITransaction;
      }
    | undefined
  >;
  maybeApplyAutoRefill: (user: string, currentBalance: number) => Promise<number>;
  createStructuredTransaction: (_txData: TxData) => Promise<TransactionResult | undefined>;
} {
  /** Calculate and set the tokenValue for a transaction */
  function calculateTokenValue(txn: InternalTxDoc) {
    const { valueKey, tokenType, model, endpointTokenConfig, inputTokenCount } = txn;
    const multiplier = Math.abs(
      txMethods.getMultiplier({
        valueKey,
        tokenType: tokenType as 'prompt' | 'completion' | undefined,
        model,
        endpointTokenConfig: endpointTokenConfig ?? undefined,
        inputTokenCount,
      }),
    );
    txn.rate = multiplier;
    txn.tokenValue = (txn.rawAmount ?? 0) * multiplier;
    if (txn.context && txn.tokenType === 'completion' && txn.context === 'incomplete') {
      txn.tokenValue = Math.ceil((txn.tokenValue ?? 0) * cancelRate);
      txn.rate = (txn.rate ?? 0) * cancelRate;
    }
  }

  /** Calculate token value for structured tokens */
  function calculateStructuredTokenValue(txn: InternalTxDoc) {
    if (!txn.tokenType) {
      txn.tokenValue = txn.rawAmount;
      return;
    }

    const { model, endpointTokenConfig, inputTokenCount } = txn;
    const etConfig = endpointTokenConfig ?? undefined;

    if (txn.tokenType === 'prompt') {
      const inputMultiplier = txMethods.getMultiplier({
        tokenType: 'prompt',
        model,
        endpointTokenConfig: etConfig,
        inputTokenCount,
      });
      const writeMultiplier =
        txMethods.getCacheMultiplier({
          cacheType: 'write',
          model,
          endpointTokenConfig: etConfig,
          inputTokenCount,
        }) ?? inputMultiplier;
      const readMultiplier =
        txMethods.getCacheMultiplier({
          cacheType: 'read',
          model,
          endpointTokenConfig: etConfig,
          inputTokenCount,
        }) ?? inputMultiplier;

      txn.rateDetail = {
        input: inputMultiplier,
        write: writeMultiplier,
        read: readMultiplier,
      };

      const totalPromptTokens =
        Math.abs(txn.inputTokens ?? 0) +
        Math.abs(txn.writeTokens ?? 0) +
        Math.abs(txn.readTokens ?? 0);

      if (totalPromptTokens > 0) {
        txn.rate =
          (Math.abs(inputMultiplier * (txn.inputTokens ?? 0)) +
            Math.abs(writeMultiplier * (txn.writeTokens ?? 0)) +
            Math.abs(readMultiplier * (txn.readTokens ?? 0))) /
          totalPromptTokens;
      } else {
        txn.rate = Math.abs(inputMultiplier);
      }

      txn.tokenValue = -(
        Math.abs(txn.inputTokens ?? 0) * inputMultiplier +
        Math.abs(txn.writeTokens ?? 0) * writeMultiplier +
        Math.abs(txn.readTokens ?? 0) * readMultiplier
      );

      txn.rawAmount = -totalPromptTokens;
    } else if (txn.tokenType === 'completion') {
      const multiplier = txMethods.getMultiplier({
        tokenType: txn.tokenType,
        model,
        endpointTokenConfig: etConfig,
        inputTokenCount,
      });
      txn.rate = Math.abs(multiplier);
      txn.tokenValue = -Math.abs(txn.rawAmount ?? 0) * multiplier;
      txn.rawAmount = -Math.abs(txn.rawAmount ?? 0);
    }

    if (txn.context && txn.tokenType === 'completion' && txn.context === 'incomplete') {
      txn.tokenValue = Math.ceil((txn.tokenValue ?? 0) * cancelRate);
      txn.rate = (txn.rate ?? 0) * cancelRate;
      if (txn.rateDetail) {
        txn.rateDetail = Object.fromEntries(
          Object.entries(txn.rateDetail).map(([k, v]) => [k, v * cancelRate]),
        );
      }
    }
  }

  /**
   * Updates a user's token balance using optimistic concurrency control.
   * Always returns an IBalance or throws after exhausting retries.
   */
  async function updateBalance({
    user,
    incrementValue,
    setValues,
  }: {
    user: string;
    incrementValue: number;
    setValues?: IBalanceUpdate;
  }): Promise<IBalance> {
    const Balance = mongoose.models.Balance as Model<IBalance>;
    const maxRetries = 10;
    let delay = 50;
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      let currentBalanceDoc: IBalance | null;
      try {
        currentBalanceDoc = await Balance.findOne({ user }).lean<IBalance>();
        const currentCredits = currentBalanceDoc ? currentBalanceDoc.tokenCredits : 0;
        const potentialNewCredits = currentCredits + incrementValue;
        const newCredits = Math.max(0, potentialNewCredits);

        const updatePayload = {
          $set: {
            tokenCredits: newCredits,
            ...(setValues ?? {}),
          },
        };

        let updatedBalance: IBalance | null = null;
        if (currentBalanceDoc) {
          updatedBalance = await Balance.findOneAndUpdate(
            { user, tokenCredits: currentCredits },
            updatePayload,
            { new: true },
          ).lean<IBalance>();

          if (updatedBalance) {
            return updatedBalance;
          }
          lastError = new Error(`Concurrency conflict for user ${user} on attempt ${attempt}.`);
        } else {
          try {
            updatedBalance = await Balance.findOneAndUpdate({ user }, updatePayload, {
              upsert: true,
              new: true,
            }).lean<IBalance>();

            if (updatedBalance) {
              return updatedBalance;
            }
            lastError = new Error(
              `Upsert race condition suspected for user ${user} on attempt ${attempt}.`,
            );
          } catch (error: unknown) {
            if (
              error instanceof Error &&
              'code' in error &&
              (error as { code: number }).code === 11000
            ) {
              lastError = error;
            } else {
              throw error;
            }
          }
        }
      } catch (error) {
        logger.error(`[updateBalance] Error during attempt ${attempt} for user ${user}:`, error);
        lastError = error instanceof Error ? error : new Error(String(error));
      }

      if (attempt < maxRetries) {
        const jitter = Math.random() * delay * 0.5;
        await new Promise((resolve) => setTimeout(resolve, delay + jitter));
        delay = Math.min(delay * 2, 2000);
      }
    }

    logger.error(
      `[updateBalance] Failed to update balance for user ${user} after ${maxRetries} attempts.`,
    );
    throw (
      lastError ??
      new Error(
        `Failed to update balance for user ${user} after maximum retries due to persistent conflicts.`,
      )
    );
  }

  /** Maximum number of recent idempotency keys retained per balance document. */
  const MAX_RECENT_IDEMPOTENCY_KEYS = 50;

  /**
   * Ensures a Balance document exists for `user`, without disturbing its
   * current value if one already does. Deliberately does NOT reuse
   * `updateBalance`'s upsert branch: that branch computes the value to write
   * from a JS-side snapshot (`currentCredits`) taken before the write, then
   * writes it unconditionally via classic `$set` if the filter matches —
   * including when the filter matches because a *concurrent* caller created
   * the document (with its own, already-incremented value) between this
   * caller's existence check and its write. That is an unconditional
   * overwrite, not a conditional one, so it silently discards the concurrent
   * caller's update. Reproduced directly: 8 concurrent first-ever credits for
   * one brand-new user settled at 2000 instead of 4000 before this fix.
   *
   * This version uses a pipeline update so the value written is always
   * computed from whatever the document's current state is *at the atomic
   * moment of the write* — `$ifNull` preserves an existing value untouched,
   * and only supplies a default when the document is truly being inserted —
   * so a match against a concurrently-created-and-updated document is a
   * genuine no-op instead of a stale overwrite. The still-possible race of
   * two callers *both* attempting a true insert is resolved by the unique
   * `{ user, tenantId }` index (schema/balance.ts): one insert wins, the
   * other gets a duplicate-key error, which is caught and treated as success
   * — the document exists now, created by the other caller.
   */
  async function ensureBalanceDocumentExists(user: string): Promise<void> {
    const Balance = mongoose.models.Balance as Model<IBalance>;
    const tenantId = getTenantId();
    const setStage: Record<string, unknown> = {
      user: { $ifNull: ['$user', user] },
      tokenCredits: { $ifNull: ['$tokenCredits', 0] },
    };
    if (tenantId && tenantId !== SYSTEM_TENANT_ID) {
      setStage.tenantId = { $ifNull: ['$tenantId', tenantId] };
    }

    try {
      await Balance.findOneAndUpdate({ user }, [{ $set: setStage }], { upsert: true });
    } catch (error) {
      const mongoError = error as { code?: number };
      if (mongoError?.code !== 11000) {
        throw error;
      }
      // Lost the insert race to a concurrent caller — the document exists now
      // (created by them), which is exactly what this function is for.
    }
  }

  /**
   * Internal: inserts the ledger row for `idempotencyKey`, or — if one
   * already exists, whether from a concurrent racer or an earlier attempt of
   * this exact call — finds and returns that one instead. Returns the row's
   * id either way, since the only thing callers need afterward is something
   * to claim audit-recording against (`claimAuditRecording`).
   */
  async function recordLedgerEntry({
    user,
    rawAmount,
    idempotencyKey,
    context,
  }: {
    user: string;
    rawAmount: number;
    idempotencyKey: string;
    context: string;
  }): Promise<string> {
    const Transaction = mongoose.models.Transaction;
    const transaction = new Transaction({
      user,
      tokenType: 'credits',
      context,
      rawAmount,
      idempotencyKey,
    });
    calculateTokenValue(transaction);

    try {
      await transaction.save();
      return (transaction._id as Types.ObjectId).toString();
    } catch (error) {
      const mongoError = error as { code?: number };
      if (mongoError?.code === 11000) {
        const existing = await Transaction.findOne({ idempotencyKey }).lean<{
          _id: Types.ObjectId;
        }>();
        if (existing) {
          return existing._id.toString();
        }
      }
      throw error;
    }
  }

  /**
   * Applies the ledger insert and the balance increment as one real
   * multi-document ACID transaction, so there is no window between them a
   * crash can land in — they commit together or neither does.
   *
   * The ledger insert's unique `idempotencyKey` index is the sole idempotency
   * gate here: a duplicate-key error on it means some *prior, fully
   * committed* transaction already applied this exact key, so there is
   * nothing left to do. That is the only outcome this function treats as
   * "already applied" — there is no bounded, evictable ring buffer in this
   * path, so there is no window where the gate can forget a key.
   *
   * The Balance upsert is a plain `$inc` (no ring buffer, no idempotency
   * check of its own needed): if two concurrent callers race to create the
   * same user's first Balance document, MongoDB surfaces that as a
   * transient write conflict, which `withTransaction` retries automatically
   * — the whole callback re-runs cleanly since the aborted attempt's ledger
   * insert never committed either.
   */
  async function applyIdempotentCreditTransactional({
    user,
    incrementValue,
    idempotencyKey,
    context,
  }: {
    user: string;
    incrementValue: number;
    idempotencyKey: string;
    context: string;
  }): Promise<{ resultingBalance: number; applied: boolean; transactionId: string }> {
    const Balance = mongoose.models.Balance as Model<IBalance>;
    const Transaction = mongoose.models.Transaction;
    const session = await mongoose.startSession();

    try {
      let resultingBalance = 0;
      let transactionId = '';

      await session.withTransaction(async () => {
        const transaction = new Transaction({
          user,
          tokenType: 'credits',
          context,
          rawAmount: incrementValue,
          idempotencyKey,
        });
        calculateTokenValue(transaction);
        await transaction.save({ session });
        transactionId = (transaction._id as Types.ObjectId).toString();

        // Plain `$inc` with `upsert: true`: Mongo treats a missing field as 0
        // on upsert, so this both creates a first-ever Balance document and
        // increments an existing one, atomically, with no separate
        // existence check needed.
        const updated = await Balance.findOneAndUpdate(
          { user },
          { $inc: { tokenCredits: incrementValue } },
          { new: true, upsert: true, session },
        ).lean<IBalance>();
        resultingBalance = updated!.tokenCredits;
      });

      return { resultingBalance, applied: true, transactionId };
    } catch (error) {
      const mongoError = error as { code?: number };
      if (mongoError?.code === 11000) {
        // This idempotencyKey already fully committed — ledger insert and
        // balance increment together — in a prior transaction.
        const existing = await Transaction.findOne({ idempotencyKey }).lean<{
          _id: Types.ObjectId;
        }>();
        if (existing) {
          const existingBalance = await Balance.findOne({ user }).lean<IBalance>();
          return {
            resultingBalance: existingBalance?.tokenCredits ?? 0,
            applied: false,
            transactionId: existing._id.toString(),
          };
        }
      }
      throw error;
    } finally {
      await session.endSession();
    }
  }

  /**
   * Fallback for deployments without a MongoDB replica set, where real
   * multi-document transactions are unavailable (`supportsTransactions`
   * returns `false`). Applies the increment and records the key in one
   * atomic single-document `findOneAndUpdate`, then writes the ledger row as
   * a second, separate step.
   *
   * This is NOT fully crash-safe the way the transactional path is: a crash
   * between the balance update and the ledger write leaves the key recorded
   * only in `recentIdempotencyKeys` (a bounded ring buffer — see
   * `MAX_RECENT_IDEMPOTENCY_KEYS`), not yet in the durable ledger. If enough
   * *other* credits land on the same user before a retry repairs it, the key
   * falls out of the ring buffer and a retry can no longer recognize it was
   * already applied, re-incrementing the balance. This is a known, accepted
   * gap specific to non-replica-set deployments — the transactional path
   * above is used whenever possible specifically to avoid it.
   */
  async function applyIdempotentCreditSingleDocument({
    user,
    incrementValue,
    idempotencyKey,
    context,
  }: {
    user: string;
    incrementValue: number;
    idempotencyKey: string;
    context: string;
  }): Promise<{ resultingBalance: number; applied: boolean; transactionId: string }> {
    const Balance = mongoose.models.Balance as Model<IBalance>;

    await ensureBalanceDocumentExists(user);

    const updated = await Balance.findOneAndUpdate(
      { user, recentIdempotencyKeys: { $ne: idempotencyKey } },
      [
        {
          $set: {
            tokenCredits: {
              $max: [0, { $add: [{ $ifNull: ['$tokenCredits', 0] }, incrementValue] }],
            },
            recentIdempotencyKeys: {
              $slice: [
                { $concatArrays: [{ $ifNull: ['$recentIdempotencyKeys', []] }, [idempotencyKey]] },
                -MAX_RECENT_IDEMPOTENCY_KEYS,
              ],
            },
          },
        },
      ],
      { new: true },
    ).lean<IBalance>();

    let resultingBalance: number;
    let applied: boolean;
    if (updated) {
      resultingBalance = updated.tokenCredits;
      applied = true;
    } else {
      // No match, and no upsert was possible here — the only way this
      // happens is that this exact key was already applied, either by this
      // call retried or a concurrent one that won the race.
      const existing = await Balance.findOne({ user }).lean<IBalance>();
      resultingBalance = existing?.tokenCredits ?? 0;
      applied = false;
    }

    const transactionId = await recordLedgerEntry({
      user,
      rawAmount: incrementValue,
      idempotencyKey,
      context,
    });

    return { resultingBalance, applied, transactionId };
  }

  /**
   * Applies a credit increment exactly once per `idempotencyKey`, AND
   * durably records its ledger row, as part of this single call — not as
   * two separately-orchestrated steps a caller could crash between.
   *
   * Checks the unbounded, uniquely-indexed Transaction ledger for this key
   * first, regardless of which path below runs: if a row already exists,
   * this operation was already fully processed at some point in the past,
   * however long ago, and must not be re-applied.
   *
   * Delegates to a real multi-document transaction
   * (`applyIdempotentCreditTransactional`) whenever the connected MongoDB
   * deployment supports one, which closes the crash window between the
   * balance update and the ledger write entirely. Only deployments without a
   * replica set — where transactions are unavailable — fall back to
   * `applyIdempotentCreditSingleDocument`, which has a known, narrower gap
   * (see its own doc comment).
   *
   * Requires the caller to have already verified the target user exists —
   * this still lazily creates a first Balance document for a legitimate user
   * who has never been credited before, so it will happily create an orphan
   * document for a bogus id if the caller skips that check.
   */
  async function applyIdempotentCredit({
    user,
    incrementValue,
    idempotencyKey,
    context,
  }: {
    user: string;
    incrementValue: number;
    idempotencyKey: string;
    context: string;
  }): Promise<{ resultingBalance: number; applied: boolean; transactionId: string }> {
    const Balance = mongoose.models.Balance as Model<IBalance>;

    const alreadyLedgered = await mongoose.models.Transaction.findOne({ idempotencyKey }).lean<{
      _id: Types.ObjectId;
    }>();
    if (alreadyLedgered) {
      const existing = await Balance.findOne({ user }).lean<IBalance>();
      return {
        resultingBalance: existing?.tokenCredits ?? 0,
        applied: false,
        transactionId: alreadyLedgered._id.toString(),
      };
    }

    const params = { user, incrementValue, idempotencyKey, context };
    if (await supportsTransactions(mongoose)) {
      return applyIdempotentCreditTransactional(params);
    }
    return applyIdempotentCreditSingleDocument(params);
  }

  const DEFAULT_AUDIT_RECORDING_LEASE_MS = 60_000;

  /**
   * Atomically claims the *attempt* to write the audit entry tied to a
   * ledger row — not completion. Returns `true` for exactly one caller at a
   * time: a concurrent racer, or a retry while a prior attempt's lease is
   * still live, both get `false`. Deliberately does NOT set `auditRecorded`
   * here — only `markAuditRecorded` does that, and only after
   * `recordAuditEntry` has confirmed success. If the caller that wins this
   * claim crashes, or the write throws, or a fail-open audit writer returns
   * `null`, `auditRecorded` is never touched; the lease either gets released
   * explicitly (`releaseAuditRecordingLease`, for a fast retry) or simply
   * expires after `leaseMs`, so a later retry can always reclaim and repair
   * it. This is what makes audit-entry writing independently repairable: a
   * crash between the ledger write (`applyIdempotentCredit`, above) and the
   * audit write is a distinct failure window from either the
   * balance-increment or the ledger-write one, and a one-way flag set before
   * the write (rather than after success) could never recover from it.
   */
  async function claimAuditRecording(
    transactionId: string,
    leaseMs: number = DEFAULT_AUDIT_RECORDING_LEASE_MS,
  ): Promise<boolean> {
    const Transaction = mongoose.models.Transaction;
    const now = new Date();
    const claimed = await Transaction.findOneAndUpdate(
      {
        _id: transactionId,
        auditRecorded: { $ne: true },
        $or: [
          { auditRecordingLeaseExpiresAt: { $exists: false } },
          { auditRecordingLeaseExpiresAt: { $lte: now } },
        ],
      },
      { $set: { auditRecordingLeaseExpiresAt: new Date(now.getTime() + leaseMs) } },
    );
    return claimed != null;
  }

  /**
   * Marks the audit entry as durably, permanently recorded. Call this ONLY
   * after `recordAuditEntry` has confirmed a successful write — this is the
   * single place `auditRecorded` ever becomes `true`.
   */
  async function markAuditRecorded(transactionId: string): Promise<void> {
    await mongoose.models.Transaction.updateOne(
      { _id: transactionId },
      { $set: { auditRecorded: true }, $unset: { auditRecordingLeaseExpiresAt: 1 } },
    );
  }

  /**
   * Releases a claimed lease without marking the audit as recorded, so a
   * confirmed-failed write can be retried immediately instead of waiting out
   * the full lease window.
   */
  async function releaseAuditRecordingLease(transactionId: string): Promise<void> {
    await mongoose.models.Transaction.updateOne(
      { _id: transactionId },
      { $unset: { auditRecordingLeaseExpiresAt: 1 } },
    );
  }

  /**
   * Explicit provisioning for the `idempotencyKey` unique index — see the
   * same `MONGO_AUTO_INDEX` rationale as `ensureBalanceRequestIndexes` in
   * methods/balanceRequest.ts.
   */
  async function ensureTransactionIdempotencyIndex(): Promise<void> {
    await mongoose.models.Transaction.createIndexes();
  }

  /**
   * Creates an auto-refill transaction that also updates balance —
   * atomically claiming the refill window itself, not just the balance
   * increment. `updateBalance`'s own CAS loop (keyed on `tokenCredits`)
   * isn't enough here: two concurrent callers can both read the same
   * overdue `lastRefill`, both decide "eligible", and both call this
   * function; `updateBalance`'s retry-on-conflict would then just re-apply
   * the second caller's increment against the first's already-refilled
   * total once its filter stops matching — a blind retry has no way to
   * know the *reason* it conflicted was "someone already did this exact
   * refill", so it does it again. Requiring the caller's just-read
   * `lastRefill` as `expectedLastRefill` and matching on it directly (not
   * on `tokenCredits`) closes that: the increment itself is computed
   * relative to the current value server-side (`$add`), so it's correct
   * even if other, unrelated spends changed `tokenCredits` concurrently —
   * but the claim only succeeds for the one caller whose view of
   * `lastRefill` is still current. A losing caller gets `undefined` back,
   * which every caller already treats the same as "not eligible".
   *
   * The ledger row is written only *after* the claim succeeds, never
   * before — a phantom ledger entry for a refill that didn't actually land
   * would be exactly the kind of untrustworthy-ledger problem the
   * deduplication migration had to work around.
   *
   * Before claiming the refill window itself, this also claims the user's
   * pending balance request (if any) via the exact same
   * `claimBalanceRequestResolution` lease `addCreditHandler` claims before
   * crediting. That lease previously only gated who got to mark a request
   * *resolved* — not who got to credit the balance in the first place — so
   * an admin claim and an auto-refill attempt racing each other could both
   * credit the same shortage before either resolved the request. Requiring
   * this claim first, in both directions, means only one of them ever
   * reaches the balance increment at all: the loser treats a failed claim
   * identically to a lost refill-window race (returns `undefined`, no
   * credit applied), and the lease is released again immediately if the
   * refill-window claim right after it is lost too, so a legitimate retry
   * (or the admin) isn't stuck waiting out the full lease for nothing. Once
   * this call wins both claims, it resolves the request itself afterward —
   * see `resolveBalanceRequestIfPending` at the bottom of this function —
   * rather than through a lease-filtered lookup, since by then it's already
   * the lease's sole holder and has nothing left to race against.
   */
  async function createAutoRefillTransaction(
    txData: TxData,
    expectedLastRefill: Date | null,
  ): Promise<
    | {
        rate: number;
        user: string;
        balance: number;
        transaction: ITransaction;
      }
    | undefined
  > {
    if (txData.rawAmount != null && isNaN(txData.rawAmount)) {
      return;
    }

    const Balance = mongoose.models.Balance as Model<IBalance>;
    const userId = txData.user as string;
    const now = new Date();

    const pendingRequest = await txMethods.findPendingBalanceRequestByUser?.(userId);
    let requestLeaseClaimed = false;
    if (pendingRequest) {
      requestLeaseClaimed =
        (await txMethods.claimBalanceRequestResolution?.(pendingRequest._id.toString(), userId)) ??
        false;
      if (!requestLeaseClaimed) {
        // An admin is actively fulfilling (or has already fulfilled) this
        // exact pending request — deferring here is what keeps the two
        // paths from both crediting the same shortage.
        logger.debug(
          '[Balance.check] Auto-refill deferred — pending request is being resolved elsewhere',
          { user: userId },
        );
        return;
      }
    }

    const filter: FilterQuery<IBalance> =
      expectedLastRefill == null
        ? { user: userId, $or: [{ lastRefill: { $exists: false } }, { lastRefill: null }] }
        : { user: userId, lastRefill: expectedLastRefill };

    const claimed = await Balance.findOneAndUpdate(
      filter,
      [
        {
          $set: {
            tokenCredits: {
              $max: [0, { $add: [{ $ifNull: ['$tokenCredits', 0] }, txData.rawAmount ?? 0] }],
            },
            lastRefill: now,
          },
        },
      ],
      { new: true },
    ).lean<IBalance>();

    if (!claimed) {
      // Lost the race for this exact refill window — another caller already
      // claimed it (or `autoRefillEnabled` flipped off concurrently and the
      // document no longer round-trips the way the caller expects). Callers
      // treat this identically to "not eligible", so no error here.
      logger.debug(
        '[Balance.check] Auto-refill claim missed — already applied by a concurrent caller',
        { user: userId },
      );
      if (requestLeaseClaimed && pendingRequest) {
        // No credit was actually applied by this call — hold the lease open
        // for nothing would just block a legitimate retry or the admin.
        await txMethods.releaseBalanceRequestResolutionLease?.(pendingRequest._id.toString());
      }
      return;
    }

    const Transaction = mongoose.models.Transaction;
    const transaction = new Transaction(txData);
    transaction.endpointTokenConfig = txData.endpointTokenConfig;
    transaction.inputTokenCount = txData.inputTokenCount;
    calculateTokenValue(transaction);
    await transaction.save();

    const result = {
      rate: transaction.rate as number,
      user: transaction.user.toString() as string,
      balance: claimed.tokenCredits,
      transaction,
    };
    logger.debug('[Balance.check] Auto-refill performed', result);

    // The refill just addressed whatever a pending "please top me up" request
    // was asking for — leaving it pending would strand the "Reset requested"
    // UI (and the admin queue) in a stale state the user already moved past.
    // Resolved by the exact id this call already claimed above, not a
    // generic "whatever's pending for this user" lookup — this call is the
    // lease's sole holder at this point, so there's nothing left to race.
    if (requestLeaseClaimed && pendingRequest) {
      try {
        await txMethods.resolveBalanceRequestIfPending?.(pendingRequest._id.toString(), userId, {
          resolvedAmount: txData.rawAmount ?? 0,
        });
      } catch (error) {
        logger.error('[Balance.check] Failed to resolve pending request after auto-refill', error);
      }
    }

    return result;
  }

  /**
   * If `currentBalance` is exhausted (`<= 0`) and the user's auto-refill is
   * configured and due, applies it and returns the refilled balance;
   * otherwise returns `currentBalance` unchanged.
   *
   * This exists because the balance-check gate (`checkBalanceRecord` in
   * `packages/api`) only ever re-checks refill eligibility against the
   * *prompt*-token cost, before generation starts — never against the
   * *completion*-token cost, which is what actually lands a user at zero.
   * `spendTokens`/`spendStructuredTokens` call this after applying the real
   * completion deduction specifically to close that gap: without it, a
   * refill that becomes due at the exact moment a message's completion
   * tokens exhaust the balance is silently skipped until the user's *next*
   * message happens to trigger the pre-flight check again.
   */
  async function maybeApplyAutoRefill(user: string, currentBalance: number): Promise<number> {
    if (currentBalance > 0) {
      return currentBalance;
    }

    const record = await findBalanceByUser(user);
    if (!record?.autoRefillEnabled || !record.refillAmount || record.refillAmount <= 0) {
      return currentBalance;
    }

    const lastRefillDate = new Date(record.lastRefill ?? 0);
    const now = new Date();
    const eligible =
      isNaN(lastRefillDate.getTime()) ||
      now >=
        getRefillEligibilityDate(
          lastRefillDate,
          record.refillIntervalValue ?? 0,
          record.refillIntervalUnit ?? 'days',
        );
    if (!eligible) {
      return currentBalance;
    }

    try {
      const result = await createAutoRefillTransaction(
        {
          user,
          tokenType: 'credits',
          context: 'autoRefill',
          rawAmount: record.refillAmount,
        },
        record.lastRefill ?? null,
      );
      if (result) {
        return result.balance;
      }
      // Lost the claim race — a concurrent caller already applied this
      // exact refill. Re-read rather than returning the stale
      // pre-refill `currentBalance`: the real balance is now higher.
      const fresh = await findBalanceByUser(user);
      return fresh?.tokenCredits ?? currentBalance;
    } catch (error) {
      logger.error('[Balance.check] Failed to auto-refill after balance exhausted', error);
      return currentBalance;
    }
  }

  /**
   * Creates a transaction and updates the balance.
   */
  async function createTransaction(_txData: TxData): Promise<TransactionResult | undefined> {
    const { balance, transactions, ...txData } = _txData;
    if (txData.rawAmount != null && isNaN(txData.rawAmount)) {
      return;
    }

    if (transactions?.enabled === false) {
      return;
    }

    const Transaction = mongoose.models.Transaction;
    const transaction = new Transaction(txData);
    transaction.endpointTokenConfig = txData.endpointTokenConfig;
    transaction.inputTokenCount = txData.inputTokenCount;
    calculateTokenValue(transaction);

    await transaction.save();
    if (!balance?.enabled) {
      return;
    }

    const incrementValue = transaction.tokenValue as number;
    const balanceResponse = await updateBalance({
      user: transaction.user as string,
      incrementValue,
    });

    return {
      rate: transaction.rate as number,
      user: transaction.user.toString() as string,
      balance: balanceResponse.tokenCredits,
      [transaction.tokenType as string]: incrementValue,
    } as TransactionResult;
  }

  /**
   * Creates a structured transaction and updates the balance.
   */
  async function createStructuredTransaction(
    _txData: TxData,
  ): Promise<TransactionResult | undefined> {
    const { balance, transactions, ...txData } = _txData;
    if (transactions?.enabled === false) {
      return;
    }

    const Transaction = mongoose.models.Transaction;
    const transaction = new Transaction(txData);
    transaction.endpointTokenConfig = txData.endpointTokenConfig;
    transaction.inputTokenCount = txData.inputTokenCount;

    calculateStructuredTokenValue(transaction);

    await transaction.save();

    if (!balance?.enabled) {
      return;
    }

    const incrementValue = transaction.tokenValue as number;

    const balanceResponse = await updateBalance({
      user: transaction.user as string,
      incrementValue,
    });

    return {
      rate: transaction.rate as number,
      user: transaction.user.toString() as string,
      balance: balanceResponse.tokenCredits,
      [transaction.tokenType as string]: incrementValue,
    } as TransactionResult;
  }

  /**
   * Queries and retrieves transactions based on a given filter.
   */
  async function getTransactions(filter: FilterQuery<ITransaction>): Promise<ITransaction[]> {
    try {
      const Transaction = mongoose.models.Transaction;
      return await Transaction.find(filter).lean<ITransaction[]>();
    } catch (error) {
      logger.error('Error querying transactions:', error);
      throw error;
    }
  }

  /** Retrieves a user's balance record. */
  async function findBalanceByUser(user: string): Promise<IBalance | null> {
    const Balance = mongoose.models.Balance as Model<IBalance>;
    return Balance.findOne({ user }).lean<IBalance>();
  }

  /** Batch-retrieves balance records for multiple users (admin list views). */
  async function findBalancesByUsers(userIds: string[]): Promise<IBalance[]> {
    if (userIds.length === 0) {
      return [];
    }
    const Balance = mongoose.models.Balance as Model<IBalance>;
    return Balance.find({ user: { $in: userIds } }).lean<IBalance[]>();
  }

  /** Upserts balance fields for a user. */
  async function upsertBalanceFields(
    user: string,
    fields: IBalanceUpdate,
  ): Promise<IBalance | null> {
    const Balance = mongoose.models.Balance as Model<IBalance>;
    return Balance.findOneAndUpdate(
      { user },
      { $set: fields },
      { upsert: true, new: true },
    ).lean<IBalance>();
  }

  /** Deletes transactions matching a filter. */
  async function deleteTransactions(
    filter: FilterQuery<ITransaction>,
  ): Promise<import('mongodb').DeleteResult> {
    const Transaction = mongoose.models.Transaction;
    return Transaction.deleteMany(filter);
  }

  /** Deletes balance records matching a filter. */
  async function deleteBalances(
    filter: FilterQuery<IBalance>,
  ): Promise<import('mongodb').DeleteResult> {
    const Balance = mongoose.models.Balance as Model<IBalance>;
    return Balance.deleteMany(filter);
  }

  async function bulkInsertTransactions(docs: TransactionData[]): Promise<void> {
    if (!docs.length) {
      return;
    }
    try {
      const Transaction = mongoose.models.Transaction;
      await Transaction.insertMany(docs);
    } catch (error) {
      logger.error('[bulkInsertTransactions] Error inserting transaction docs:', error);
      throw error;
    }
  }

  return {
    updateBalance,
    applyIdempotentCredit,
    claimAuditRecording,
    markAuditRecorded,
    releaseAuditRecordingLease,
    ensureTransactionIdempotencyIndex,
    bulkInsertTransactions,
    findBalanceByUser,
    findBalancesByUsers,
    upsertBalanceFields,
    getTransactions,
    deleteTransactions,
    deleteBalances,
    createTransaction,
    createAutoRefillTransaction,
    maybeApplyAutoRefill,
    createStructuredTransaction,
  };
}

export type TransactionMethods = ReturnType<typeof createTransactionMethods>;
