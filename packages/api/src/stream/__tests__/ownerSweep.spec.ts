import type { Agents } from 'librechat-data-provider';
import type {
  ProviderExecutionRef,
  ProviderLeaseOptions,
  ProviderLeaseState,
} from '~/stream/interfaces/IJobStore';
import type { AbortResult } from '~/stream/GenerationJobManager';
import { InMemoryEventTransport } from '~/stream/implementations/InMemoryEventTransport';
import { InMemoryJobStore } from '~/stream/implementations/InMemoryJobStore';
import { GenerationJobManagerClass } from '~/stream/GenerationJobManager';

const LEASE = { enabled: true, ttlMs: 3_000, refreshMs: 1_000, selfFence: true };
const LAPSED: ProviderLeaseState = {
  capable: true,
  leased: false,
  held: false,
  owner: null,
  leaseTtlMs: null,
};

/** In-memory store shared by every "replica" of a test, with the lease, drain-recovery
 * and salvage-claim operations the Redis store provides. */
class LeasingJobStore extends InMemoryJobStore {
  leaseState: ProviderLeaseState = { ...LAPSED, leased: true, owner: 'owner', leaseTtlMs: 2_500 };
  private readonly salvageClaims = new Set<string>();

  renewProviderLeases = jest.fn(
    async (executions: ProviderExecutionRef[], _lease: ProviderLeaseOptions) =>
      executions.map(() => true),
  );

  releaseProviderLease = jest.fn(async () => undefined);
  holdProviderExecution = jest.fn(async () => undefined);
  getProviderLeaseState = jest.fn(async (): Promise<ProviderLeaseState> => this.leaseState);

  claimOrphanSalvage = jest.fn(async (streamId: string, createdAt: number) => {
    const key = `${streamId}:${createdAt}`;
    if (this.salvageClaims.has(key)) {
      return false;
    }
    this.salvageClaims.add(key);
    return true;
  });

  releaseOrphanSalvage = jest.fn(async (streamId: string, createdAt: number) => {
    this.salvageClaims.delete(`${streamId}:${createdAt}`);
  });

  recoverOrphanedProviderExecution = jest.fn(
    async (streamId: string, createdAt: number, providerExecutionId: string) => {
      const job = await this.getJob(streamId);
      if (this.leaseState.leased || this.leaseState.held || !this.leaseState.capable) {
        return 0 as const;
      }
      if (
        job?.createdAt !== createdAt ||
        job.providerExecutionId !== providerExecutionId ||
        job.providerDrained !== false
      ) {
        return 2 as const;
      }
      await this.updateJob(streamId, { providerDrained: true }, createdAt);
      return 1 as const;
    },
  );
}

function createReplica(
  store: LeasingJobStore,
  options: { orphanSweep?: boolean; orphanSweepIntervalMs?: number } = {},
): GenerationJobManagerClass {
  const manager = new GenerationJobManagerClass();
  /** Each replica has its own transport: the dead owner must not see the survivors' abort. */
  manager.configure({
    jobStore: store,
    eventTransport: new InMemoryEventTransport(),
    isRedis: false,
    ownerLease: LEASE,
    orphanSalvage: true,
    orphanSweepIntervalMs: 5_000,
    /** Keep finished jobs so a test can read the terminal status. */
    cleanupOnComplete: false,
    ...options,
  });
  manager.initialize();
  return manager;
}

const PARTIAL: Agents.MessageContentComplex[] = [
  { type: 'text', text: 'Hello dead owner' } as Agents.MessageContentComplex,
];

/** SIGKILL equivalent: the owner stops renewing its lease and runs no self-fence (which
 * would abort the generation itself). */
function killOwner(owner: GenerationJobManagerClass): void {
  const internals = owner as unknown as {
    stopOwnerLeaseTimer: () => void;
    disarmSelfFence: (entry: unknown) => void;
    armSelfFence: (entry: unknown) => void;
    renewOwnerLeases: () => Promise<void>;
    openProviderExecutions: Map<string, unknown>;
  };
  internals.stopOwnerLeaseTimer();
  for (const entry of internals.openProviderExecutions.values()) {
    internals.disarmSelfFence(entry);
  }
  jest.spyOn(internals, 'armSelfFence').mockImplementation(() => undefined);
  jest.spyOn(internals, 'renewOwnerLeases').mockResolvedValue(undefined);
}

/** Start a generation on its own replica with a running provider and streamed output,
 * then kill that replica. */
async function startDeadOwner(store: LeasingJobStore, streamId: string) {
  const owner = createReplica(store);
  const job = await owner.createJob(streamId, 'user-1', streamId);
  const executionId = job.metadata.providerExecutionId!;
  await expect(owner.beginProviderExecution(streamId, job.createdAt, executionId)).resolves.toBe(
    true,
  );
  owner.setContentParts(streamId, PARTIAL, job.createdAt);
  killOwner(owner);
  return { owner, job, executionId };
}

function savedHandler() {
  const saved: AbortResult[] = [];
  const handler = jest.fn(async (_streamId: string, result: AbortResult) => {
    saved.push(result);
  });
  return { saved, handler };
}

describe('GenerationJobManager orphaned generation sweep', () => {
  const managers: GenerationJobManagerClass[] = [];

  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(async () => {
    jest.useRealTimers();
    for (const manager of managers.splice(0)) {
      await manager.destroy({ settlementBudgetMs: 0 }).catch(() => undefined);
    }
  });

  it('finishes a subscribed generation once its dead owner lease lapses', async () => {
    const store = new LeasingJobStore({ ttlAfterComplete: 60_000 });
    const streamId = 'stream-sweep-subscriber';
    const { owner, job } = await startDeadOwner(store, streamId);
    const relay = createReplica(store, { orphanSweep: true });
    managers.push(owner, relay);
    const { saved, handler } = savedHandler();
    relay.setOrphanedGenerationHandler(handler);

    const onDone = jest.fn();
    const subscription = await relay.subscribe(streamId, () => undefined, onDone);
    expect(subscription).not.toBeNull();

    /** Live lease: the watchdog checks but leaves the generation alone. */
    await jest.advanceTimersByTimeAsync(2_100);
    expect(store.getProviderLeaseState).toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();

    store.leaseState = LAPSED;
    await jest.advanceTimersByTimeAsync(1_100);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(saved[0].content).toEqual([expect.objectContaining({ text: 'Hello dead owner' })]);
    expect(saved[0].jobData?.createdAt).toBe(job.createdAt);
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onDone.mock.calls[0][0]).toMatchObject({ final: true, aborted: true });
    await expect(store.getJob(streamId)).resolves.toMatchObject({
      createdAt: job.createdAt,
      status: 'aborted',
      providerDrained: true,
    });

    /** Finished once; later ticks do nothing more. */
    await jest.advanceTimersByTimeAsync(3_000);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(store.claimOrphanSalvage).toHaveBeenCalledTimes(1);
    subscription?.unsubscribe();
  });

  it.each([
    ['the lease is live', { ...LAPSED, leased: true, owner: 'owner', leaseTtlMs: 2_500 }],
    ['the execution is held', { ...LAPSED, held: true }],
    ['the owner is not lease-aware', { ...LAPSED, capable: false }],
  ])('leaves a subscribed generation running while %s', async (_case, state) => {
    const store = new LeasingJobStore({ ttlAfterComplete: 60_000 });
    store.leaseState = state;
    const streamId = 'stream-sweep-untouched';
    const { owner, job } = await startDeadOwner(store, streamId);
    const relay = createReplica(store);
    managers.push(owner, relay);
    const { handler } = savedHandler();
    relay.setOrphanedGenerationHandler(handler);
    const onDone = jest.fn();
    const subscription = await relay.subscribe(streamId, () => undefined, onDone);

    await jest.advanceTimersByTimeAsync(12_000);

    expect(store.getProviderLeaseState).toHaveBeenCalled();
    expect(store.claimOrphanSalvage).not.toHaveBeenCalled();
    expect(store.recoverOrphanedProviderExecution).not.toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
    await expect(store.getJob(streamId)).resolves.toMatchObject({
      createdAt: job.createdAt,
      status: 'running',
    });
    subscription?.unsubscribe();
  });

  it('never finishes a generation this process owns', async () => {
    const store = new LeasingJobStore({ ttlAfterComplete: 60_000 });
    store.leaseState = LAPSED;
    const streamId = 'stream-sweep-own';
    const owner = createReplica(store);
    managers.push(owner);
    const { handler } = savedHandler();
    owner.setOrphanedGenerationHandler(handler);
    const job = await owner.createJob(streamId, 'user-1', streamId);
    await owner.beginProviderExecution(streamId, job.createdAt, job.metadata.providerExecutionId!);
    const subscription = await owner.subscribe(streamId, () => undefined);

    await jest.advanceTimersByTimeAsync(12_000);

    expect(store.claimOrphanSalvage).not.toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
    await expect(store.getJob(streamId)).resolves.toMatchObject({ status: 'running' });
    subscription?.unsubscribe();
  });

  it('sweeps a lapsed generation nobody is subscribed to', async () => {
    const store = new LeasingJobStore({ ttlAfterComplete: 60_000 });
    const streamId = 'stream-sweep-unwatched';
    const { owner, job } = await startDeadOwner(store, streamId);
    const sweeper = createReplica(store);
    managers.push(owner, sweeper);
    const { saved, handler } = savedHandler();
    sweeper.setOrphanedGenerationHandler(handler);
    store.leaseState = LAPSED;

    await jest.advanceTimersByTimeAsync(4_900);
    expect(handler).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(200);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(saved[0].content).toEqual([expect.objectContaining({ text: 'Hello dead owner' })]);
    await expect(store.getJob(streamId)).resolves.toMatchObject({
      createdAt: job.createdAt,
      status: 'aborted',
      providerDrained: true,
    });
  });

  it('two replicas sweeping the same lapsed generation finish it once', async () => {
    const store = new LeasingJobStore({ ttlAfterComplete: 60_000 });
    const streamId = 'stream-sweep-race';
    const { owner } = await startDeadOwner(store, streamId);
    const first = createReplica(store);
    const second = createReplica(store);
    managers.push(owner, first, second);
    const { handler } = savedHandler();
    first.setOrphanedGenerationHandler(handler);
    second.setOrphanedGenerationHandler(handler);
    store.leaseState = LAPSED;

    /** Both sweeps read the running job before either one finishes it. */
    type Sweeper = { sweepOrphanedGenerations: () => Promise<void> };
    await Promise.all(
      [first, second].map((replica) => (replica as unknown as Sweeper).sweepOrphanedGenerations()),
    );

    expect(store.claimOrphanSalvage).toHaveBeenCalledTimes(2);
    expect(store.recoverOrphanedProviderExecution).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledTimes(1);
    await expect(store.getJob(streamId)).resolves.toMatchObject({ status: 'aborted' });
  });

  it('does nothing with the sweep switched off', async () => {
    const store = new LeasingJobStore({ ttlAfterComplete: 60_000 });
    const streamId = 'stream-sweep-off';
    const { owner } = await startDeadOwner(store, streamId);
    const relay = createReplica(store, { orphanSweep: false });
    managers.push(owner, relay);
    const { handler } = savedHandler();
    relay.setOrphanedGenerationHandler(handler);
    store.leaseState = LAPSED;
    const subscription = await relay.subscribe(streamId, () => undefined);

    await jest.advanceTimersByTimeAsync(12_000);

    expect(store.getProviderLeaseState).not.toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
    await expect(store.getJob(streamId)).resolves.toMatchObject({ status: 'running' });
    subscription?.unsubscribe();
  });
});
