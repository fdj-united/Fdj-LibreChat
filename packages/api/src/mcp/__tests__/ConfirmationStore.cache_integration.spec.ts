import type { Redis, Cluster } from 'ioredis';
import type { RedisClientsModule } from '~/cache/__tests__/redisClients.helper';
import type * as ConfirmationStoreModule from '~/mcp/ConfirmationStore';
import { closeRedisClients } from '~/cache/__tests__/redisClients.helper';

/**
 * Two ConfirmationStore instances with their own Redis connections stand in for
 * two LibreChat replicas: the agent waits on replica A while the user's click
 * lands on replica B.
 */
describe('ConfirmationStore Redis relay integration', () => {
  let storeModule: typeof ConfirmationStoreModule;
  let redisClientsModule: RedisClientsModule;
  let connections: Array<Redis | Cluster> = [];
  let relays: ConfirmationStoreModule.RedisConfirmationRelay[] = [];

  beforeAll(async () => {
    process.env.USE_REDIS = process.env.USE_REDIS ?? 'true';
    process.env.REDIS_URI = process.env.REDIS_URI ?? 'redis://127.0.0.1:6379';
    process.env.REDIS_KEY_PREFIX =
      process.env.REDIS_KEY_PREFIX ??
      `ConfirmationStore-IntegrationTest-${Date.now()}-${Math.random().toString(36).substring(7)}`;
    process.env.REDIS_PING_INTERVAL = '0';

    jest.resetModules();
    redisClientsModule = await import('~/cache/redisClients');
    storeModule = await import('~/mcp/ConfirmationStore');
  });

  afterEach(async () => {
    await Promise.all(relays.map((relay) => relay.close()));
    connections.forEach((connection) => connection.disconnect());
    relays = [];
    connections = [];
  });

  afterAll(async () => {
    await closeRedisClients(redisClientsModule);
  });

  function createReplica(options?: ConfirmationStoreModule.ConfirmationStoreOptions): {
    store: ConfirmationStoreModule.ConfirmationStore;
    relay: ConfirmationStoreModule.RedisConfirmationRelay;
    connection: Redis | Cluster;
  } {
    const { ioredisClient } = redisClientsModule;
    if (!ioredisClient) {
      throw new Error('ioredisClient is not configured; is USE_REDIS set?');
    }
    const connection = ioredisClient.duplicate();
    const relay = new storeModule.RedisConfirmationRelay(connection);
    connections.push(connection);
    relays.push(relay);
    return { store: new storeModule.ConfirmationStore(relay, options), relay, connection };
  }

  const recordKey = (confirmationId: string) => `mcp_confirmation:${confirmationId}`;

  it('wires the Redis relay into the shared store when USE_REDIS is enabled', async () => {
    const store = storeModule.getConfirmationStore();
    const { confirmationId } = await store.register('user-1', 5_000);
    const { connection } = createReplica();

    expect(await connection.hget(recordKey(confirmationId), 'owner')).toBe('user-1');

    await store.resolve(confirmationId, 'user-1', 'cancel');
    await storeModule.__resetConfirmationStoreForTests();
  });

  it('delivers a decision posted to another replica', async () => {
    const replicaA = createReplica();
    const replicaB = createReplica();

    const { confirmationId, waitForDecision } = await replicaA.store.register('user-1', 5_000);
    const result = await replicaB.store.resolve(confirmationId, 'user-1', 'accept');

    expect(result).toEqual({ ok: true });
    await expect(waitForDecision).resolves.toEqual({ decision: 'accept' });
    expect(replicaA.store.has(confirmationId)).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(await replicaA.connection.exists(recordKey(confirmationId))).toBe(0);
  });

  it('delivers an acknowledged decision even when the waiting replica missed the notification', async () => {
    const replicaA = createReplica({ pollIntervalMs: 50 });
    const replicaB = createReplica();

    const { confirmationId, waitForDecision } = await replicaA.store.register('user-1', 5_000);
    await replicaA.relay.close();

    expect(await replicaB.store.resolve(confirmationId, 'user-1', 'accept')).toEqual({ ok: true });
    await expect(waitForDecision).resolves.toEqual({ decision: 'accept' });
  });

  it('settles with a decision recorded just before the deadline', async () => {
    const replicaA = createReplica({ pollIntervalMs: 60_000 });
    const replicaB = createReplica();

    const { confirmationId, waitForDecision } = await replicaA.store.register('user-1', 150);
    await replicaA.relay.close();
    await replicaB.store.resolve(confirmationId, 'user-1', 'accept');

    await expect(waitForDecision).resolves.toEqual({ decision: 'accept' });
  });

  it('rejects user decisions after the deadline even if the waiting replica has not timed out yet', async () => {
    const { relay, connection } = createReplica();
    const confirmationId = 'late-decision';

    await relay.claim(confirmationId, 'user-1', 50);
    await new Promise((resolve) => setTimeout(resolve, 80));

    expect(await relay.decide(confirmationId, 'user-1', 'accept')).toEqual({
      ok: false,
      reason: 'not_found',
    });
    expect(await relay.decide(confirmationId, 'user-1', 'timeout')).toEqual({ ok: true });
    expect(await relay.read(confirmationId)).toBe('timeout');
    await connection.del(recordKey(confirmationId));
  });

  it('acknowledges only the first of a local and a remote decision', async () => {
    const replicaA = createReplica();
    const replicaB = createReplica();

    for (let i = 0; i < 25; i++) {
      const { confirmationId, waitForDecision } = await replicaA.store.register('user-1', 5_000);
      const [remote, local] = await Promise.all([
        replicaB.store.resolve(confirmationId, 'user-1', 'accept'),
        replicaA.store.resolve(confirmationId, 'user-1', 'cancel'),
      ]);

      expect([remote, local].filter((result) => result.ok)).toHaveLength(1);
      const outcome = await waitForDecision;
      expect(outcome.decision).toBe(remote.ok ? 'accept' : 'cancel');
    }
  });

  it('rejects another user on a different replica and keeps the confirmation pending', async () => {
    const replicaA = createReplica();
    const replicaB = createReplica();

    const { confirmationId, waitForDecision } = await replicaA.store.register('user-1', 5_000);

    expect(await replicaB.store.resolve(confirmationId, 'attacker', 'accept')).toEqual({
      ok: false,
      reason: 'forbidden',
    });
    expect(replicaA.store.has(confirmationId)).toBe(true);

    expect(await replicaB.store.resolve(confirmationId, 'user-1', 'cancel')).toEqual({ ok: true });
    await expect(waitForDecision).resolves.toEqual({ decision: 'cancel' });
  });

  it('accepts only the first of concurrent decisions across replicas', async () => {
    const replicaA = createReplica();
    const replicaB = createReplica();
    const replicaC = createReplica();

    const { confirmationId, waitForDecision } = await replicaA.store.register('user-1', 5_000);
    const results = await Promise.all([
      replicaB.store.resolve(confirmationId, 'user-1', 'accept'),
      replicaC.store.resolve(confirmationId, 'user-1', 'cancel'),
    ]);

    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results).toContainEqual({ ok: false, reason: 'not_found' });
    const outcome = await waitForDecision;
    expect(['accept', 'cancel']).toContain(outcome.decision);
  });

  it('releases the shared record on local resolution and on timeout', async () => {
    const replicaA = createReplica();
    const replicaB = createReplica();

    const local = await replicaA.store.register('user-1', 5_000);
    await replicaA.store.resolve(local.confirmationId, 'user-1', 'accept');

    const expiring = await replicaA.store.register('user-1', 200);
    await expect(expiring.waitForDecision).resolves.toEqual({ decision: 'timeout' });

    await new Promise((resolve) => setTimeout(resolve, 50));
    for (const { confirmationId } of [local, expiring]) {
      expect(await replicaA.connection.exists(recordKey(confirmationId))).toBe(0);
      expect(await replicaB.store.resolve(confirmationId, 'user-1', 'accept')).toEqual({
        ok: false,
        reason: 'not_found',
      });
    }
  });
});
