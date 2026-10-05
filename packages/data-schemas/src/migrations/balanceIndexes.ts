import type { Collection } from 'mongodb';
import { retryWithBackoff } from '~/utils/retry';
import logger from '~/config/winston';

interface DuplicateGroup {
  _id: { user: unknown; tenantId: unknown };
  ids: unknown[];
  count: number;
}

const DEDUPE_LOCK_ID = 'balanceDedupe';
const DEDUPE_LOCK_LEASE_MS = 5 * 60_000;
const DEDUPE_LOCK_RENEWAL_MS = 60_000;
const INDEX_WAIT_POLL_MS = 2_000;
const INDEX_WAIT_MAX_MS = 10 * 60_000;
const UNIQUE_INDEX_NAME = 'user_1_tenantId_1';

const UNMERGEABLE_REASON =
  'automatic reconstruction is not possible: `recentIdempotencyKeys` is a bounded ring buffer ' +
  '(older keys are evicted as new credits land) and never maps a key to the specific amount ' +
  'it contributed within a document, so no combination of key coverage — overlapping, ' +
  "per-document, or otherwise — can prove a document's full value is accounted for. A " +
  'duplicated grant that later received additional legitimate, individually-keyed credits ' +
  '(e.g. duplicated 1000/1000 starting balances that become 1100/1200 after two separate ' +
  '+100/+200 credits) is indistinguishable from one that never had an untracked duplicate at ' +
  'all. Manual reconciliation is required for every duplicate group';

/**
 * Claims exclusive ownership of a dedupe run via a single, fixed-`_id` lock
 * document, tagged with a fresh, random `ownerToken`. The upsert's filter
 * only matches an absent lock or an expired one, so a currently-held,
 * unexpired lock can never be overwritten — and `_id`'s implicit unique
 * index turns the "no lock document exists yet" bootstrap race (two
 * processes both upserting for the first time) into the same outcome:
 * exactly one caller's write wins, the other sees a duplicate-key error.
 * Either race path is reported back as "not acquired", never as a thrown
 * error — a replica that loses the race should quietly defer to whichever
 * instance is already running the migration, not fail startup.
 *
 * The owner token is what makes renewal and release safe under expiry: see
 * `renewDedupeLockLease` and `releaseDedupeLock`.
 */
export async function claimDedupeLock(
  mongoose: typeof import('mongoose'),
): Promise<{ acquired: boolean; ownerToken: string }> {
  // `connection.db` isn't guaranteed populated the instant Mongoose reports
  // "connected" — this is the first `.db` access in the whole module, so
  // guard it here rather than let a transient timing gap throw an opaque
  // "Cannot read properties of undefined (reading 'collection')" that takes
  // down the entire process (startup treats a failed migration as fatal).
  await mongoose.connection.asPromise();
  const locks = mongoose.connection.db!.collection('migrationlocks');
  const now = new Date();
  const ownerToken = new mongoose.Types.ObjectId().toString();
  try {
    await locks.updateOne(
      {
        _id: DEDUPE_LOCK_ID as never,
        $or: [{ leaseExpiresAt: { $exists: false } }, { leaseExpiresAt: { $lte: now } }],
      },
      {
        $set: {
          leaseExpiresAt: new Date(now.getTime() + DEDUPE_LOCK_LEASE_MS),
          claimedAt: now,
          ownerToken,
        },
      },
      { upsert: true },
    );
    return { acquired: true, ownerToken };
  } catch (error) {
    const mongoError = error as { code?: number };
    if (mongoError?.code === 11000) {
      return { acquired: false, ownerToken: '' };
    }
    throw error;
  }
}

/**
 * Extends the lease by `DEDUPE_LOCK_LEASE_MS`, but only if `ownerToken`
 * still matches the document on disk — a renewal from a process that has
 * (somehow) lost ownership is a safe no-op, never a resurrection of a stale
 * claim. Called periodically (`startLeaseRenewal`) for the whole duration
 * of a run, so a dataset with many duplicate groups taking longer than one
 * lease window never has its lock mistaken for abandoned and reclaimed out
 * from under it mid-run.
 */
export async function renewDedupeLockLease(
  mongoose: typeof import('mongoose'),
  ownerToken: string,
): Promise<boolean> {
  const result = await mongoose.connection
    .db!.collection('migrationlocks')
    .updateOne(
      { _id: DEDUPE_LOCK_ID as never, ownerToken },
      { $set: { leaseExpiresAt: new Date(Date.now() + DEDUPE_LOCK_LEASE_MS) } },
    );
  return result.matchedCount > 0;
}

/** Starts periodic lease renewal for `ownerToken`; returns a function that
 *  stops it. A failed renewal (lost ownership) is logged loudly but doesn't
 *  throw — the run already in flight finishes what it can; the lock itself
 *  stays correct because every subsequent write below is a plain,
 *  independently-safe operation, not reliant on holding the lock for its
 *  own correctness beyond ruling out another *migration* instance. */
function startLeaseRenewal(mongoose: typeof import('mongoose'), ownerToken: string): () => void {
  const interval = setInterval(() => {
    renewDedupeLockLease(mongoose, ownerToken)
      .then((renewed) => {
        if (!renewed) {
          logger.error(
            '[BalanceMigration] Lost ownership of the dedupe lock mid-run — another instance ' +
              'may now be running concurrently.',
          );
        }
      })
      .catch((err) => logger.error('[BalanceMigration] Failed to renew dedupe lock lease:', err));
  }, DEDUPE_LOCK_RENEWAL_MS);
  return () => clearInterval(interval);
}

/** Releases the dedupe lock, but only if `ownerToken` still matches — a
 *  release from a process that lost its lease (and had it reclaimed by a
 *  newer owner) must never delete that newer owner's lock. Safe to call
 *  unconditionally, including after an error. */
export async function releaseDedupeLock(
  mongoose: typeof import('mongoose'),
  ownerToken: string,
): Promise<void> {
  await mongoose.connection.db!.collection('migrationlocks').deleteOne({
    _id: DEDUPE_LOCK_ID as never,
    ownerToken,
  });
}

/**
 * `updateBalance`'s upsert branch (and, before this fix, `applyIdempotentCredit`'s)
 * relied on a unique `{ user, tenantId }` index to turn a concurrent "first ever
 * credit for this user" race into a retryable duplicate-key error. That index
 * was never actually provisioned, so concurrent upserts could — and, under load,
 * did — create multiple Balance documents for the same user, each capturing a
 * different subset of their real balance.
 *
 * This migration detects any such duplicates already on disk and quarantines
 * every one of them — it never attempts to automatically merge, under any
 * circumstances, on any deployment. See `UNMERGEABLE_REASON`: idempotency-key
 * evidence is bounded and never maps a key to the specific amount it
 * contributed within a document, so there is no sound way to prove a
 * document's full value is accounted for — not via overlapping-key
 * reconciliation, not via requiring every document to carry a key, not via
 * cross-referencing the Transaction ledger. Every one of those approaches was
 * tried across prior review rounds and each admits a concrete counter-example
 * where it would silently produce the wrong total. Quarantining unconditionally
 * is the only version of this migration that cannot miscompute a balance.
 *
 * Concurrency-safe across migration instances regardless: the whole run is
 * gated by an owner-scoped, renewable exclusive lock (`claimDedupeLock`) so
 * only one instance ever processes a given group at a time, and an instance
 * that loses its lease can never have its lock stolen by, nor steal the lock
 * from, another owner. This mainly avoids redundant duplicate-detection work
 * and duplicate log noise across replicas at every startup — correctness no
 * longer depends on it, since no deployment ever writes to a duplicate group.
 */
export async function dedupeBalanceDocuments(mongoose: typeof import('mongoose')): Promise<{
  mergedGroups: number;
  deletedDocuments: number;
  quarantinedGroups: number;
  lockAcquired: boolean;
}> {
  const result = {
    mergedGroups: 0,
    deletedDocuments: 0,
    quarantinedGroups: 0,
    lockAcquired: false,
  };

  const { acquired, ownerToken } = await claimDedupeLock(mongoose);
  result.lockAcquired = acquired;
  if (!acquired) {
    logger.info(
      '[BalanceMigration] Another instance already holds the dedupe lock — skipping this run.',
    );
    return result;
  }

  const stopRenewal = startLeaseRenewal(mongoose, ownerToken);
  try {
    const collection = mongoose.connection.db!.collection('balances');

    const duplicateGroups = (await collection
      .aggregate([
        {
          $group: {
            _id: { user: '$user', tenantId: '$tenantId' },
            ids: { $push: '$_id' },
            count: { $sum: 1 },
          },
        },
        { $match: { count: { $gt: 1 } } },
      ])
      .toArray()) as unknown as DuplicateGroup[];

    for (const group of duplicateGroups) {
      const count = await collection.countDocuments({ _id: { $in: group.ids as never[] } });
      if (count < 2) {
        // Already resolved by some other means between the aggregation and
        // this check — nothing to report.
        continue;
      }

      result.quarantinedGroups += 1;
      logger.error(
        `[BalanceMigration] Leaving ${count} duplicate Balance documents for user ` +
          `${String(group._id.user)} (tenant ${String(group._id.tenantId)}) UNMERGED — ` +
          `${UNMERGEABLE_REASON}.`,
      );
    }

    if (result.quarantinedGroups > 0) {
      logger.error(
        `[BalanceMigration] ${result.quarantinedGroups} user(s) left with unmerged duplicate ` +
          `Balance documents pending manual reconciliation — see prior error log lines.`,
      );
    }

    return result;
  } finally {
    stopRenewal();
    await releaseDedupeLock(mongoose, ownerToken);
  }
}

/** True while the dedupe lock is currently held by *some* unexpired owner —
 *  doesn't care which one, just whether anyone is actively claiming the
 *  work. Used by `waitForIndexOrFail` to tell "still working" apart from
 *  "finished (one way or another) and let the lock go". */
async function isDedupeLockHeld(mongoose: typeof import('mongoose')): Promise<boolean> {
  const lock = (await mongoose.connection.db!.collection('migrationlocks').findOne({
    _id: DEDUPE_LOCK_ID as never,
  })) as { leaseExpiresAt?: Date } | null;
  return lock?.leaseExpiresAt != null && lock.leaseExpiresAt.getTime() > Date.now();
}

/**
 * For the instance that lost the race to claim the dedupe lock: losing that
 * race must never be treated as "nothing to do, startup can proceed" — the
 * unique index might not exist yet, and the winner might be about to find
 * duplicates it can't safely merge and exit without ever creating it. If
 * this instance then started serving traffic anyway, it would be running
 * without the index *and* without ever having surfaced the duplicate data
 * that still needs manual reconciliation.
 *
 * Instead, this polls for the one outcome that actually matters — the index
 * existing — and fails closed the moment it's clear the winner finished
 * without creating it (lock released or expired, index still absent),
 * rather than waiting out the full timeout for an outcome that's already
 * decided. A bounded overall ceiling guards against polling forever in some
 * unanticipated stuck state.
 */
async function waitForIndexOrFail(
  mongoose: typeof import('mongoose'),
  collection: Collection,
): Promise<{ created: string[] }> {
  const deadline = Date.now() + INDEX_WAIT_MAX_MS;
  while (Date.now() < deadline) {
    if (await collection.indexExists(UNIQUE_INDEX_NAME)) {
      logger.info(
        '[BalanceMigration] Unique index already present — created by the instance that held ' +
          'the dedupe lock.',
      );
      return { created: [] };
    }
    if (!(await isDedupeLockHeld(mongoose))) {
      throw new Error(
        '[BalanceMigration] The instance that held the dedupe lock finished without creating ' +
          'the unique balances index — it most likely found duplicate Balance documents it ' +
          'could not safely merge and exited. Refusing to start up without the index in ' +
          "place; reconcile the duplicates manually (see that instance's logs) and restart.",
      );
    }
    await new Promise((resolve) => setTimeout(resolve, INDEX_WAIT_POLL_MS));
  }
  throw new Error(
    '[BalanceMigration] Timed out waiting for another instance to finish building the unique ' +
      'balances index.',
  );
}

/**
 * Ensures the unique `{ user, tenantId }` index exists on the Balance
 * collection, flagging any pre-existing violations first. Idempotent —
 * createIndex is a no-op when the index already exists with the same
 * definition. Refuses to proceed while any duplicate group remains
 * quarantined — building the index anyway would fail outright (duplicates
 * still violate it); halting here keeps the unresolved data intact and the
 * failure visible instead of silently leaving the index missing.
 *
 * If another instance already holds the dedupe lock, this instance does
 * *not* short-circuit as if there were nothing left to do — see
 * `waitForIndexOrFail`. Lock contention is not completion: this instance
 * only returns successfully once the index actually exists, and fails
 * closed (never silently proceeds) if the winner finishes without it.
 */
export async function ensureBalanceIndexes(
  mongoose: typeof import('mongoose'),
): Promise<{ created: string[] }> {
  const { quarantinedGroups, lockAcquired } = await dedupeBalanceDocuments(mongoose);
  const collection = mongoose.connection.db!.collection('balances');
  if (!lockAcquired) {
    return waitForIndexOrFail(mongoose, collection);
  }
  if (quarantinedGroups > 0) {
    throw new Error(
      `[BalanceMigration] Refusing to create the unique balances index: ${quarantinedGroups} ` +
        `user(s) have duplicate Balance documents that could not be safely merged. Reconcile ` +
        `them manually (see error logs above) and re-run this migration.`,
    );
  }

  const name = await retryWithBackoff(
    () => collection.createIndex({ user: 1, tenantId: 1 }, { unique: true }),
    'balances.{user:1,tenantId:1}',
  );
  if (!name) {
    throw new Error('[BalanceMigration] Index creation returned no name');
  }

  logger.info(`[BalanceMigration] Ensured unique index: balances.${name}`);
  return { created: [`balances.${name}`] };
}
