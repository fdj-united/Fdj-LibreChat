import type {
  AgentFileRetentionDeps,
  RetentionCandidate,
  StartAgentFileRetentionDeps,
} from './agentFileRetention';
import { sweepAgentFiles, startAgentFileRetentionSweep } from './agentFileRetention';

const HOUR_MS = 60 * 60 * 1000;

function makeLogger() {
  return { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
}

function candidate(overrides: Partial<RetentionCandidate> = {}): RetentionCandidate {
  return {
    file_id: overrides.file_id ?? 'f1',
    filepath: overrides.filepath ?? '/uploads/u1/f1__doc.pdf',
    user: overrides.user ?? 'u1',
  };
}

describe('sweepAgentFiles', () => {
  const FIXED_NOW = new Date('2026-07-23T12:00:00Z').getTime();
  const now = () => FIXED_NOW;

  it('deletes candidates returned for a configured agent', async () => {
    const logger = makeLogger();
    const getExpiredAgentUploads = jest
      .fn()
      .mockResolvedValue([candidate({ file_id: 'a' }), candidate({ file_id: 'b' })]);
    const deleteDiskFile = jest.fn().mockResolvedValue('deleted');

    const result = await sweepAgentFiles(
      { rules: [{ agentId: 'agent_1', retentionHours: 8 }] },
      { getExpiredAgentUploads, deleteDiskFile, logger, now },
    );

    expect(result).toEqual({ scanned: 2, deleted: 2, missing: 0, failed: 0, skippedAgents: 0 });
    expect(deleteDiskFile).toHaveBeenCalledTimes(2);
  });

  it('computes the cutoff as now minus retentionHours', async () => {
    const getExpiredAgentUploads = jest.fn().mockResolvedValue([]);
    await sweepAgentFiles(
      { rules: [{ agentId: 'agent_1', retentionHours: 8 }] },
      { getExpiredAgentUploads, deleteDiskFile: jest.fn(), logger: makeLogger(), now },
    );
    const cutoff: Date = getExpiredAgentUploads.mock.calls[0][1];
    expect(cutoff.getTime()).toBe(FIXED_NOW - 8 * HOUR_MS);
  });

  it('applies each agent’s own retention window', async () => {
    const getExpiredAgentUploads = jest.fn().mockResolvedValue([]);
    await sweepAgentFiles(
      {
        rules: [
          { agentId: 'a8', retentionHours: 8 },
          { agentId: 'a24', retentionHours: 24 },
        ],
      },
      { getExpiredAgentUploads, deleteDiskFile: jest.fn(), logger: makeLogger(), now },
    );
    expect(getExpiredAgentUploads.mock.calls[0][0]).toBe('a8');
    expect(getExpiredAgentUploads.mock.calls[0][1].getTime()).toBe(FIXED_NOW - 8 * HOUR_MS);
    expect(getExpiredAgentUploads.mock.calls[1][0]).toBe('a24');
    expect(getExpiredAgentUploads.mock.calls[1][1].getTime()).toBe(FIXED_NOW - 24 * HOUR_MS);
  });

  it('counts a missing disk file separately and never as a failure', async () => {
    const deleteDiskFile = jest
      .fn()
      .mockResolvedValueOnce('deleted')
      .mockResolvedValueOnce('missing');
    const result = await sweepAgentFiles(
      { rules: [{ agentId: 'a', retentionHours: 8 }] },
      {
        getExpiredAgentUploads: jest.fn().mockResolvedValue([candidate(), candidate()]),
        deleteDiskFile,
        logger: makeLogger(),
        now,
      },
    );
    expect(result.deleted).toBe(1);
    expect(result.missing).toBe(1);
    expect(result.failed).toBe(0);
  });

  it('counts a delete error as failed and continues with the remaining files', async () => {
    const deleteDiskFile = jest
      .fn()
      .mockRejectedValueOnce(new Error('EACCES'))
      .mockResolvedValueOnce('deleted');
    const result = await sweepAgentFiles(
      { rules: [{ agentId: 'a', retentionHours: 8 }] },
      {
        getExpiredAgentUploads: jest.fn().mockResolvedValue([candidate(), candidate()]),
        deleteDiskFile,
        logger: makeLogger(),
        now,
      },
    );
    expect(result.failed).toBe(1);
    expect(result.deleted).toBe(1);
  });

  it('is fail-closed: a lookup error skips that agent and deletes nothing for it', async () => {
    const deleteDiskFile = jest.fn().mockResolvedValue('deleted');
    const getExpiredAgentUploads = jest
      .fn()
      .mockRejectedValueOnce(new Error('mongo down'))
      .mockResolvedValueOnce([candidate({ user: 'u2' })]);
    const logger = makeLogger();

    const result = await sweepAgentFiles(
      {
        rules: [
          { agentId: 'bad', retentionHours: 8 },
          { agentId: 'good', retentionHours: 8 },
        ],
      },
      { getExpiredAgentUploads, deleteDiskFile, logger, now },
    );

    expect(result.skippedAgents).toBe(1);
    expect(result.deleted).toBe(1); // only the healthy agent's file
    expect(deleteDiskFile).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalled();
  });

  it('dry-run deletes nothing but still scans and logs', async () => {
    const deleteDiskFile = jest.fn();
    const logger = makeLogger();
    const result = await sweepAgentFiles(
      { rules: [{ agentId: 'a', retentionHours: 8 }], dryRun: true },
      {
        getExpiredAgentUploads: jest.fn().mockResolvedValue([candidate(), candidate()]),
        deleteDiskFile,
        logger,
        now,
      },
    );
    expect(deleteDiskFile).not.toHaveBeenCalled();
    expect(result.scanned).toBe(2);
    expect(result.deleted).toBe(0);
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('(dry-run) would delete'));
  });

  it('no-ops on empty rules', async () => {
    const deleteDiskFile = jest.fn();
    const getExpiredAgentUploads = jest.fn();
    const result = await sweepAgentFiles(
      { rules: [] },
      { getExpiredAgentUploads, deleteDiskFile, logger: makeLogger(), now },
    );
    expect(result.scanned).toBe(0);
    expect(getExpiredAgentUploads).not.toHaveBeenCalled();
  });

  it.each([
    ['empty agentId', { agentId: '', retentionHours: 8 }],
    ['zero hours', { agentId: 'a', retentionHours: 0 }],
    ['negative hours', { agentId: 'a', retentionHours: -5 }],
    ['NaN hours', { agentId: 'a', retentionHours: Number.NaN }],
    ['Infinity hours', { agentId: 'a', retentionHours: Number.POSITIVE_INFINITY }],
  ])('ignores invalid rule (%s)', async (_label, rule) => {
    const getExpiredAgentUploads = jest.fn().mockResolvedValue([candidate()]);
    const result = await sweepAgentFiles(
      { rules: [rule as { agentId: string; retentionHours: number }] },
      { getExpiredAgentUploads, deleteDiskFile: jest.fn(), logger: makeLogger(), now },
    );
    expect(getExpiredAgentUploads).not.toHaveBeenCalled();
    expect(result.scanned).toBe(0);
  });

  it('tolerates a null/empty candidate list from the lookup', async () => {
    const result = await sweepAgentFiles(
      { rules: [{ agentId: 'a', retentionHours: 8 }] },
      {
        getExpiredAgentUploads: jest.fn().mockResolvedValue(null as unknown as RetentionCandidate[]),
        deleteDiskFile: jest.fn(),
        logger: makeLogger(),
        now,
      },
    );
    expect(result.scanned).toBe(0);
  });

  it('handles a large candidate set without dropping any', async () => {
    const many = Array.from({ length: 500 }, (_v, i) => candidate({ file_id: `f${i}` }));
    const deleteDiskFile = jest.fn().mockResolvedValue('deleted');
    const result = await sweepAgentFiles(
      { rules: [{ agentId: 'a', retentionHours: 8 }] },
      { getExpiredAgentUploads: jest.fn().mockResolvedValue(many), deleteDiskFile, logger: makeLogger(), now },
    );
    expect(result.scanned).toBe(500);
    expect(result.deleted).toBe(500);
  });
});

describe('startAgentFileRetentionSweep', () => {
  const baseDeps = (): StartAgentFileRetentionDeps => ({
    getExpiredAgentUploads: jest.fn().mockResolvedValue([]),
    deleteDiskFile: jest.fn(),
    sweepAgentFiles: jest.fn().mockResolvedValue({
      scanned: 0,
      deleted: 0,
      missing: 0,
      failed: 0,
      skippedAgents: 0,
    }),
    logger: makeLogger(),
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('returns null and never sweeps when there are no valid rules', () => {
    const deps = baseDeps();
    const handle = startAgentFileRetentionSweep({ rules: [] }, deps);
    expect(handle).toBeNull();
    expect(deps.sweepAgentFiles).not.toHaveBeenCalled();
  });

  it('returns null when intervalMs is 0 (explicitly disabled)', () => {
    const deps = baseDeps();
    const handle = startAgentFileRetentionSweep(
      { rules: [{ agentId: 'a', retentionHours: 8 }], intervalMs: 0 },
      deps,
    );
    expect(handle).toBeNull();
    expect(deps.sweepAgentFiles).not.toHaveBeenCalled();
  });

  it('runs an immediate sweep and schedules the interval', () => {
    jest.useFakeTimers();
    const setIntervalSpy = jest.spyOn(global, 'setInterval');
    const deps = baseDeps();

    const handle = startAgentFileRetentionSweep(
      { rules: [{ agentId: 'a', retentionHours: 8 }], intervalMs: 1000 },
      deps,
    );

    expect(handle).not.toBeNull();
    expect(deps.sweepAgentFiles).toHaveBeenCalledTimes(1); // immediate run
    expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 1000);
    clearInterval(handle as NodeJS.Timeout);
    setIntervalSpy.mockRestore();
  });

  it('does not overlap runs while a previous sweep is still in-flight', async () => {
    jest.useFakeTimers();
    let resolveSweep: (v: unknown) => void = () => {};
    const deps = baseDeps();
    (deps.sweepAgentFiles as jest.Mock).mockImplementation(
      () => new Promise((resolve) => (resolveSweep = resolve)),
    );

    const handle = startAgentFileRetentionSweep(
      { rules: [{ agentId: 'a', retentionHours: 8 }], intervalMs: 10 },
      deps,
    );

    // Immediate run is in-flight; fire several intervals before it resolves.
    jest.advanceTimersByTime(50);
    expect(deps.sweepAgentFiles).toHaveBeenCalledTimes(1);

    resolveSweep({ scanned: 0, deleted: 0, missing: 0, failed: 0, skippedAgents: 0 });
    await Promise.resolve();
    clearInterval(handle as NodeJS.Timeout);
  });
});
