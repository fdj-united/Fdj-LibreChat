import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import {
  dedupeBalanceDocuments,
  ensureBalanceIndexes,
  claimDedupeLock,
  renewDedupeLockLease,
  releaseDedupeLock,
} from './balanceIndexes';

jest.mock('~/config/winston', () => ({
  error: jest.fn(),
  warn: jest.fn(),
  info: jest.fn(),
  debug: jest.fn(),
}));

let mongoServer: InstanceType<typeof MongoMemoryServer>;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

beforeEach(async () => {
  await mongoose.connection.dropDatabase();
});

function balances() {
  return mongoose.connection.db!.collection('balances');
}

function transactions() {
  return mongoose.connection.db!.collection('transactions');
}

function locks() {
  return mongoose.connection.db!.collection('migrationlocks');
}

describe('claimDedupeLock / renewDedupeLockLease / releaseDedupeLock', () => {
  test('assigns a distinct owner token on each successful claim', async () => {
    const first = await claimDedupeLock(mongoose);
    expect(first.acquired).toBe(true);
    await releaseDedupeLock(mongoose, first.ownerToken);

    const second = await claimDedupeLock(mongoose);
    expect(second.acquired).toBe(true);
    expect(second.ownerToken).not.toBe(first.ownerToken);
  });

  test('does not acquire while another owner holds an unexpired lease', async () => {
    const first = await claimDedupeLock(mongoose);
    expect(first.acquired).toBe(true);

    const second = await claimDedupeLock(mongoose);
    expect(second.acquired).toBe(false);
  });

  test('renewDedupeLockLease extends the lease only for the current owner', async () => {
    await locks().insertOne({
      _id: 'balanceDedupe' as never,
      ownerToken: 'owner-a',
      leaseExpiresAt: new Date(Date.now() + 1000),
    });

    expect(await renewDedupeLockLease(mongoose, 'owner-b')).toBe(false);
    const unchanged = await locks().findOne({ _id: 'balanceDedupe' as never });
    expect(unchanged?.leaseExpiresAt.getTime()).toBeLessThan(Date.now() + 2000);

    expect(await renewDedupeLockLease(mongoose, 'owner-a')).toBe(true);
    const renewed = await locks().findOne({ _id: 'balanceDedupe' as never });
    expect(renewed?.leaseExpiresAt.getTime()).toBeGreaterThan(Date.now() + 60_000);
  });

  test('releaseDedupeLock only releases the lock for the matching owner — an expired former owner cannot delete the current one', async () => {
    await locks().insertOne({
      _id: 'balanceDedupe' as never,
      ownerToken: 'current-owner',
      leaseExpiresAt: new Date(Date.now() + 60_000),
    });

    // A stale/expired former owner retrying its own cleanup must not be able
    // to delete whoever holds the lock now.
    await releaseDedupeLock(mongoose, 'expired-former-owner');
    expect(await locks().findOne({ _id: 'balanceDedupe' as never })).not.toBeNull();

    await releaseDedupeLock(mongoose, 'current-owner');
    expect(await locks().findOne({ _id: 'balanceDedupe' as never })).toBeNull();
  });
});

describe('dedupeBalanceDocuments', () => {
  test('quarantines a duplicate group with ordinary distinct amounts and no keys at all', async () => {
    const logger = jest.requireMock('~/config/winston') as { error: jest.Mock };
    const userId = new mongoose.Types.ObjectId();
    await balances().insertMany([
      { user: userId, tenantId: 'tenant-a', tokenCredits: 500 },
      { user: userId, tenantId: 'tenant-a', tokenCredits: 300 },
    ]);

    const result = await dedupeBalanceDocuments(mongoose);

    expect(result.mergedGroups).toBe(0);
    expect(result.quarantinedGroups).toBe(1);
    const remaining = await balances().find({ user: userId }).toArray();
    expect(remaining).toHaveLength(2);
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('reconstruction is not possible'),
    );
  });

  test('quarantines a group even when every document carries its own key and any overlap is fully ledger-backed', async () => {
    // Previously treated as "safe" across earlier review rounds. No longer:
    // a key proves a document received *some* specific credit, never that
    // the document's *entire* value is accounted for.
    const userId = new mongoose.Types.ObjectId();
    await transactions().insertMany([
      { user: userId, idempotencyKey: 'key-shared', rawAmount: 400 },
      { user: userId, idempotencyKey: 'key-unique', rawAmount: 300 },
    ]);
    await balances().insertMany([
      {
        user: userId,
        tenantId: 'tenant-a',
        tokenCredits: 400,
        recentIdempotencyKeys: ['key-shared'],
      },
      {
        user: userId,
        tenantId: 'tenant-a',
        tokenCredits: 700,
        recentIdempotencyKeys: ['key-shared', 'key-unique'],
      },
    ]);

    const result = await dedupeBalanceDocuments(mongoose);

    expect(result.mergedGroups).toBe(0);
    expect(result.quarantinedGroups).toBe(1);
    const remaining = await balances().find({ user: userId }).toArray();
    expect(remaining).toHaveLength(2);
    expect(remaining.map((d) => d.tokenCredits).sort()).toEqual([400, 700]);
  });

  test('quarantines a duplicated starting balance that later received distinct, individually-keyed credits (the review counter-example)', async () => {
    // Duplicated 1000/1000 starting balances, each later receiving its own
    // separate, fully-keyed, fully-ledgered credit (+100 and +200) — every
    // document has a key, no key overlaps another, so prior rounds' checks
    // would have approved merging to 2300. The true total is 1300 (one
    // 1000 base, since the other 1000 was never real, plus 100 + 200).
    const logger = jest.requireMock('~/config/winston') as { error: jest.Mock };
    const userId = new mongoose.Types.ObjectId();
    await transactions().insertMany([
      { user: userId, idempotencyKey: 'key-1', rawAmount: 100 },
      { user: userId, idempotencyKey: 'key-2', rawAmount: 200 },
    ]);
    await balances().insertMany([
      { user: userId, tenantId: 'tenant-a', tokenCredits: 1100, recentIdempotencyKeys: ['key-1'] },
      { user: userId, tenantId: 'tenant-a', tokenCredits: 1200, recentIdempotencyKeys: ['key-2'] },
    ]);

    const result = await dedupeBalanceDocuments(mongoose);

    expect(result.mergedGroups).toBe(0);
    expect(result.quarantinedGroups).toBe(1);
    const remaining = await balances().find({ user: userId }).toArray();
    expect(remaining).toHaveLength(2);
    expect(remaining.map((d) => d.tokenCredits).sort((a, b) => a - b)).toEqual([1100, 1200]);
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('reconstruction is not possible'),
    );
  });

  test('quarantines identical zero amounts too — unconditional means unconditional', async () => {
    const userId = new mongoose.Types.ObjectId();
    await balances().insertMany([
      { user: userId, tenantId: 'tenant-a', tokenCredits: 0 },
      { user: userId, tenantId: 'tenant-a', tokenCredits: 0 },
    ]);

    const result = await dedupeBalanceDocuments(mongoose);

    expect(result.mergedGroups).toBe(0);
    expect(result.quarantinedGroups).toBe(1);
    expect(await balances().countDocuments({ user: userId })).toBe(2);
  });

  test('counts and quarantines multiple independent duplicate groups in a single run', async () => {
    const userA = new mongoose.Types.ObjectId();
    const userB = new mongoose.Types.ObjectId();
    await balances().insertMany([
      { user: userA, tenantId: 'tenant-a', tokenCredits: 500 },
      { user: userA, tenantId: 'tenant-a', tokenCredits: 300 },
      { user: userB, tenantId: 'tenant-a', tokenCredits: 100 },
      { user: userB, tenantId: 'tenant-a', tokenCredits: 200 },
    ]);

    const result = await dedupeBalanceDocuments(mongoose);

    expect(result.quarantinedGroups).toBe(2);
    expect(await balances().countDocuments({})).toBe(4);
  });

  test('leaves distinct users and distinct tenants for the same user untouched', async () => {
    const userA = new mongoose.Types.ObjectId();
    const userB = new mongoose.Types.ObjectId();
    await balances().insertMany([
      { user: userA, tenantId: 'tenant-a', tokenCredits: 100 },
      { user: userA, tenantId: 'tenant-b', tokenCredits: 200 },
      { user: userB, tenantId: 'tenant-a', tokenCredits: 300 },
    ]);

    const result = await dedupeBalanceDocuments(mongoose);

    expect(result.mergedGroups).toBe(0);
    expect(result.quarantinedGroups).toBe(0);
    expect(await balances().countDocuments({})).toBe(3);
  });

  test('is a no-op on a database with no duplicates', async () => {
    const result = await dedupeBalanceDocuments(mongoose);
    expect(result).toEqual({
      mergedGroups: 0,
      deletedDocuments: 0,
      quarantinedGroups: 0,
      lockAcquired: true,
    });
  });

  test('skips entirely, making no changes, when another instance already holds the dedupe lock', async () => {
    const userId = new mongoose.Types.ObjectId();
    await balances().insertMany([
      { user: userId, tenantId: 'tenant-a', tokenCredits: 500 },
      { user: userId, tenantId: 'tenant-a', tokenCredits: 300 },
    ]);
    await locks().insertOne({
      _id: 'balanceDedupe' as never,
      ownerToken: 'someone-else',
      leaseExpiresAt: new Date(Date.now() + 60_000),
      claimedAt: new Date(),
    });

    const result = await dedupeBalanceDocuments(mongoose);

    expect(result).toEqual({
      mergedGroups: 0,
      deletedDocuments: 0,
      quarantinedGroups: 0,
      lockAcquired: false,
    });
    expect(await balances().countDocuments({ user: userId })).toBe(2);
  });

  test('treats an expired lock as reclaimable', async () => {
    const userId = new mongoose.Types.ObjectId();
    await balances().insertMany([
      { user: userId, tenantId: 'tenant-a', tokenCredits: 500 },
      { user: userId, tenantId: 'tenant-a', tokenCredits: 300 },
    ]);
    await locks().insertOne({
      _id: 'balanceDedupe' as never,
      ownerToken: 'crashed-owner',
      leaseExpiresAt: new Date(Date.now() - 60_000),
      claimedAt: new Date(Date.now() - 120_000),
    });

    const result = await dedupeBalanceDocuments(mongoose);

    expect(result.lockAcquired).toBe(true);
    expect(result.quarantinedGroups).toBe(1);
  });
});

describe('ensureBalanceIndexes', () => {
  test('refuses to create the index while any pre-existing duplicate remains quarantined', async () => {
    const userId = new mongoose.Types.ObjectId();
    await balances().insertMany([
      { user: userId, tenantId: 'tenant-a', tokenCredits: 500 },
      { user: userId, tenantId: 'tenant-a', tokenCredits: 300 },
    ]);

    await expect(ensureBalanceIndexes(mongoose)).rejects.toThrow(
      /Refusing to create the unique balances index/,
    );

    expect(await balances().countDocuments({ user: userId })).toBe(2);
    expect(await balances().indexExists('user_1_tenantId_1')).toBe(false);
  });

  test('builds the index normally when there are no duplicates to begin with', async () => {
    await expect(ensureBalanceIndexes(mongoose)).resolves.toEqual({
      created: ['balances.user_1_tenantId_1'],
    });
  });

  test('is idempotent — running twice does not error', async () => {
    await ensureBalanceIndexes(mongoose);
    await expect(ensureBalanceIndexes(mongoose)).resolves.toEqual({
      created: ['balances.user_1_tenantId_1'],
    });
  });

  test('the resulting unique index rejects a direct duplicate insert', async () => {
    await ensureBalanceIndexes(mongoose);
    const userId = new mongoose.Types.ObjectId();
    await balances().insertOne({ user: userId, tenantId: 'tenant-a', tokenCredits: 100 });

    await expect(
      balances().insertOne({ user: userId, tenantId: 'tenant-a', tokenCredits: 50 }),
    ).rejects.toMatchObject({ code: 11000 });
  });

  test('waits for — rather than short-circuiting past — another instance holding the lock, and succeeds once that instance creates the index', async () => {
    await balances().insertOne({
      user: new mongoose.Types.ObjectId(),
      tenantId: 'tenant-a',
      tokenCredits: 100,
    });
    await locks().insertOne({
      _id: 'balanceDedupe' as never,
      ownerToken: 'someone-else',
      leaseExpiresAt: new Date(Date.now() + 60_000),
      claimedAt: new Date(),
    });

    const pending = ensureBalanceIndexes(mongoose);

    // Simulate the other instance finishing successfully shortly after:
    // it creates the index and releases the lock.
    await new Promise((resolve) => setTimeout(resolve, 100));
    await balances().createIndex({ user: 1, tenantId: 1 }, { unique: true });
    await locks().deleteOne({ _id: 'balanceDedupe' as never });

    await expect(pending).resolves.toEqual({ created: [] });
  }, 10_000);

  test('fails startup — rather than returning success — once it detects the lock holder finished without ever creating the index', async () => {
    // The exact scenario this fixes: replica A holds the lock, finds
    // duplicates it can't safely merge, quarantines them, and exits
    // without creating the index. Replica B must not treat losing the
    // lock race as "nothing to do" — it has to notice the index was never
    // built and fail its own startup too.
    await balances().insertOne({
      user: new mongoose.Types.ObjectId(),
      tenantId: 'tenant-a',
      tokenCredits: 100,
    });
    await locks().insertOne({
      _id: 'balanceDedupe' as never,
      ownerToken: 'someone-else',
      leaseExpiresAt: new Date(Date.now() + 60_000),
      claimedAt: new Date(),
    });

    const pending = ensureBalanceIndexes(mongoose);

    // Simulate replica A quarantining duplicates and exiting: the lock is
    // released, but the index is never created.
    await new Promise((resolve) => setTimeout(resolve, 100));
    await locks().deleteOne({ _id: 'balanceDedupe' as never });

    await expect(pending).rejects.toThrow(/finished without creating/);
    expect(await balances().indexExists('user_1_tenantId_1')).toBe(false);
  }, 10_000);
});
