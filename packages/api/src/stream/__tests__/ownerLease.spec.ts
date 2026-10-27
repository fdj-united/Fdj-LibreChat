import type {
  ProviderExecutionRef,
  ProviderLeaseOptions,
  ProviderLeaseState,
} from '~/stream/interfaces/IJobStore';
import { InMemoryEventTransport } from '~/stream/implementations/InMemoryEventTransport';
import { InMemoryJobStore } from '~/stream/implementations/InMemoryJobStore';
import { GenerationJobManagerClass } from '~/stream/GenerationJobManager';

/** In-memory store that also accepts owner leases, so the manager's lease timer and
 * waiter logic can be exercised without Redis. */
class LeasingJobStore extends InMemoryJobStore {
  renewProviderLeases = jest.fn(
    async (executions: ProviderExecutionRef[], _lease: ProviderLeaseOptions) =>
      executions.map(() => true),
  );

  releaseProviderLease = jest.fn(async () => undefined);
  holdProviderExecution = jest.fn(async () => undefined);
  getProviderLeaseState = jest.fn(
    async (): Promise<ProviderLeaseState> => ({
      capable: false,
      leased: false,
      held: false,
      owner: null,
      leaseTtlMs: null,
    }),
  );
}

type LeaseInternals = {
  ownerLeaseTimer: NodeJS.Timeout | null;
  _ownerLease: { enabled: boolean; ttlMs: number; refreshMs: number; selfFence: boolean };
};

function createManager(ownerLease: Partial<LeaseInternals['_ownerLease']> = {}): {
  manager: GenerationJobManagerClass;
  store: LeasingJobStore;
  internals: LeaseInternals;
} {
  const store = new LeasingJobStore({ ttlAfterComplete: 60_000 });
  const manager = new GenerationJobManagerClass();
  manager.configure({
    jobStore: store,
    eventTransport: new InMemoryEventTransport(),
    isRedis: false,
    ownerLease: { enabled: true, ttlMs: 3_000, refreshMs: 1_000, selfFence: true, ...ownerLease },
  });
  manager.initialize();
  return { manager, store, internals: manager as unknown as LeaseInternals };
}

describe('GenerationJobManager owner lease', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('passes the lease with the provider begin and renews it until the drain', async () => {
    jest.useFakeTimers();
    const { manager, store, internals } = createManager();
    const beginSpy = jest.spyOn(store, 'beginProviderExecution');
    const job = await manager.createJob('stream-lease-timer', 'user-1');
    const executionId = job.metadata.providerExecutionId!;

    expect(internals.ownerLeaseTimer).toBeNull();
    await expect(
      manager.beginProviderExecution('stream-lease-timer', job.createdAt, executionId),
    ).resolves.toBe(true);
    expect(beginSpy).toHaveBeenCalledWith('stream-lease-timer', job.createdAt, executionId, {
      ttlMs: 3_000,
      ownerId: expect.stringMatching(/:\d+$/),
    });
    expect(internals.ownerLeaseTimer).not.toBeNull();

    await jest.advanceTimersByTimeAsync(2_100);
    expect(store.renewProviderLeases).toHaveBeenCalledTimes(2);
    expect(store.renewProviderLeases).toHaveBeenLastCalledWith(
      [
        {
          streamId: 'stream-lease-timer',
          createdAt: job.createdAt,
          providerExecutionId: executionId,
        },
      ],
      { ttlMs: 3_000, ownerId: expect.any(String) },
    );

    await manager.markProviderExecutionDrained('stream-lease-timer', job.createdAt, executionId);
    expect(store.releaseProviderLease).toHaveBeenCalledWith(
      'stream-lease-timer',
      job.createdAt,
      executionId,
    );
    expect(internals.ownerLeaseTimer).toBeNull();
    await jest.advanceTimersByTimeAsync(3_000);
    expect(store.renewProviderLeases).toHaveBeenCalledTimes(2);

    await manager.destroy();
  });

  it('sends the legacy 1-key begin and starts no timer with the kill switch off', async () => {
    const { manager, store, internals } = createManager({ enabled: false });
    const beginSpy = jest.spyOn(store, 'beginProviderExecution');
    const job = await manager.createJob('stream-lease-off', 'user-1');
    const executionId = job.metadata.providerExecutionId!;

    await manager.beginProviderExecution('stream-lease-off', job.createdAt, executionId);
    expect(beginSpy).toHaveBeenCalledWith('stream-lease-off', job.createdAt, executionId);
    expect(internals.ownerLeaseTimer).toBeNull();

    await manager.abandonProviderExecution('stream-lease-off', job.createdAt, executionId);
    expect(store.holdProviderExecution).not.toHaveBeenCalled();
    await manager.destroy();
  });

  it('holds an abandoned leased execution and stops renewing it', async () => {
    const { manager, store, internals } = createManager();
    const job = await manager.createJob('stream-lease-hold', 'user-1');
    const executionId = job.metadata.providerExecutionId!;
    await manager.beginProviderExecution('stream-lease-hold', job.createdAt, executionId);

    await manager.abandonProviderExecution('stream-lease-hold', job.createdAt, executionId);
    expect(store.holdProviderExecution).toHaveBeenCalledWith(
      'stream-lease-hold',
      job.createdAt,
      executionId,
    );
    expect(internals.ownerLeaseTimer).toBeNull();
    await manager.destroy();
  });

  it('leaves no lease timer behind after destroy', async () => {
    const { manager, internals } = createManager();
    const job = await manager.createJob('stream-lease-destroy', 'user-1');
    await manager.beginProviderExecution(
      'stream-lease-destroy',
      job.createdAt,
      job.metadata.providerExecutionId!,
    );
    expect(internals.ownerLeaseTimer).not.toBeNull();

    await manager.destroy();
    expect(internals.ownerLeaseTimer).toBeNull();
  });

  it('clamps the refresh interval to a third of the TTL', () => {
    const { internals } = createManager({ ttlMs: 9_000, refreshMs: 5_000 });
    expect(internals._ownerLease).toMatchObject({ ttlMs: 9_000, refreshMs: 3_000 });
  });

  it('does not let a hung renewal block the next tick', async () => {
    jest.useFakeTimers();
    const { manager, store } = createManager({ selfFence: false });
    const job = await manager.createJob('stream-lease-hung', 'user-1');
    await manager.beginProviderExecution(
      'stream-lease-hung',
      job.createdAt,
      job.metadata.providerExecutionId!,
    );
    store.renewProviderLeases.mockImplementation(() => new Promise(() => undefined));

    await jest.advanceTimersByTimeAsync(3_100);
    /** Ticks at 1 s, 2 s (after the first times out at 2 s) and 3 s still send. */
    expect(store.renewProviderLeases.mock.calls.length).toBeGreaterThanOrEqual(2);
    await manager.destroy();
  });

  it('fences instead of renewing when a stall outlived the lease', async () => {
    jest.useFakeTimers();
    const { manager, store } = createManager();
    const job = await manager.createJob('stream-lease-stall', 'user-1');
    await manager.beginProviderExecution(
      'stream-lease-stall',
      job.createdAt,
      job.metadata.providerExecutionId!,
    );
    const clock = manager as unknown as {
      monotonicNow: () => number;
      renewOwnerLeases: () => Promise<void>;
    };
    /** The event loop was blocked for longer than the TTL: no timer ran meanwhile, and the
     *  renewal that would run next would succeed. */
    const stalledAt = clock.monotonicNow() + 3_000 + 100;
    jest.spyOn(clock, 'monotonicNow').mockReturnValue(stalledAt);

    await clock.renewOwnerLeases();

    expect(job.abortController.signal.aborted).toBe(true);
    expect(store.renewProviderLeases).not.toHaveBeenCalled();
    await manager.destroy();
  });

  it('self-fences only after renewals have failed for TTL minus refresh', async () => {
    jest.useFakeTimers();
    const { manager, store } = createManager();
    const job = await manager.createJob('stream-lease-fence', 'user-1');
    await manager.beginProviderExecution(
      'stream-lease-fence',
      job.createdAt,
      job.metadata.providerExecutionId!,
    );
    store.renewProviderLeases.mockRejectedValue(new Error('Redis unavailable'));

    await jest.advanceTimersByTimeAsync(1_100);
    expect(job.abortController.signal.aborted).toBe(false);
    /** TTL 3 s, refresh 1 s: the tick at 2 s is the last one before the lease can lapse. */
    await jest.advanceTimersByTimeAsync(1_000);
    expect(job.abortController.signal.aborted).toBe(true);

    await manager.destroy();
  });
});
