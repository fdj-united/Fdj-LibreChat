const os = require('os');
const path = require('path');
const fs = require('fs');
const fsp = require('fs').promises;

jest.mock('@librechat/data-schemas', () => ({
  logger: { warn: jest.fn(), debug: jest.fn(), error: jest.fn(), info: jest.fn() },
}));

jest.mock('@librechat/api', () => ({
  sweepAgentFiles: jest.fn(),
  startAgentFileRetentionSweep: jest.fn(),
}));

const { createDeleteDiskFile, startAgentFileRetention } = require('./agentFileRetention');
const { startAgentFileRetentionSweep } = require('@librechat/api');

describe('createDeleteDiskFile (disk-only, path-safe)', () => {
  let uploadsBase;

  beforeEach(() => {
    uploadsBase = fs.mkdtempSync(path.join(os.tmpdir(), 'lc-uploads-'));
  });

  afterEach(() => {
    fs.rmSync(uploadsBase, { recursive: true, force: true });
  });

  const writeUserFile = (user, name, content = 'data') => {
    const dir = path.join(uploadsBase, user);
    fs.mkdirSync(dir, { recursive: true });
    const p = path.join(dir, name);
    fs.writeFileSync(p, content);
    return p;
  };

  it('deletes a real file under <uploads>/<user>/ and returns "deleted"', async () => {
    const del = createDeleteDiskFile(uploadsBase);
    const physical = writeUserFile('u1', 'f1__doc.pdf');
    expect(fs.existsSync(physical)).toBe(true);

    const outcome = await del({ filepath: '/uploads/u1/f1__doc.pdf', user: 'u1' });

    expect(outcome).toBe('deleted');
    expect(fs.existsSync(physical)).toBe(false);
  });

  it('returns "missing" (idempotent) when the file is already gone', async () => {
    const del = createDeleteDiskFile(uploadsBase);
    const outcome = await del({ filepath: '/uploads/u1/never__there.pdf', user: 'u1' });
    expect(outcome).toBe('missing');
  });

  it('strips a query string before resolving the path', async () => {
    const del = createDeleteDiskFile(uploadsBase);
    const physical = writeUserFile('u1', 'f1__doc.pdf');
    const outcome = await del({ filepath: '/uploads/u1/f1__doc.pdf?manual=true', user: 'u1' });
    expect(outcome).toBe('deleted');
    expect(fs.existsSync(physical)).toBe(false);
  });

  it('refuses path traversal in the filename and deletes nothing outside the dir', async () => {
    const del = createDeleteDiskFile(uploadsBase);
    // A sensitive file two levels up from <uploads>/u1
    const outside = path.join(uploadsBase, '..', 'secret.txt');
    fs.writeFileSync(outside, 'top-secret');

    await expect(
      del({ filepath: '/uploads/u1/../../secret.txt', user: 'u1' }),
    ).rejects.toThrow(/outside/i);

    expect(fs.existsSync(outside)).toBe(true);
    fs.rmSync(outside, { force: true });
  });

  it("refuses a filepath that does not belong to the candidate's user", async () => {
    const del = createDeleteDiskFile(uploadsBase);
    const victim = writeUserFile('u2', 'victim.pdf');
    await expect(
      del({ filepath: '/uploads/u2/victim.pdf', user: 'u1' }),
    ).rejects.toThrow(/outside the owner/i);
    expect(fs.existsSync(victim)).toBe(true);
  });

  it('refuses a filepath not under /uploads/', async () => {
    const del = createDeleteDiskFile(uploadsBase);
    await expect(
      del({ filepath: '/images/u1/pic.png', user: 'u1' }),
    ).rejects.toThrow(/outside the owner/i);
  });

  it('refuses an absolute path injected as the filepath', async () => {
    const del = createDeleteDiskFile(uploadsBase);
    await expect(del({ filepath: '/etc/passwd', user: 'u1' })).rejects.toThrow(/outside the owner/i);
  });

  it('refuses an empty relative name (bare /uploads/<user>/)', async () => {
    const del = createDeleteDiskFile(uploadsBase);
    await expect(del({ filepath: '/uploads/u1/', user: 'u1' })).rejects.toThrow(/Invalid file path/i);
  });

  it('deletes files inside a nested subfolder (e.g. skill-style paths)', async () => {
    const del = createDeleteDiskFile(uploadsBase);
    const dir = path.join(uploadsBase, 'u1', 'sub');
    fs.mkdirSync(dir, { recursive: true });
    const physical = path.join(dir, 'nested.pdf');
    fs.writeFileSync(physical, 'x');
    const outcome = await del({ filepath: '/uploads/u1/sub/nested.pdf', user: 'u1' });
    expect(outcome).toBe('deleted');
    expect(fs.existsSync(physical)).toBe(false);
  });
});

describe('startAgentFileRetention (wiring / guards)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('no-ops (returns null) when no agents are configured', () => {
    expect(startAgentFileRetention({ fileRetention: { agents: [] }, paths: { uploads: '/x' } })).toBeNull();
    expect(startAgentFileRetention({ paths: { uploads: '/x' } })).toBeNull();
    expect(startAgentFileRetentionSweep).not.toHaveBeenCalled();
  });

  it('no-ops when the local uploads path is missing', () => {
    const handle = startAgentFileRetention({
      fileRetention: { agents: [{ agentId: 'a', retentionHours: 8 }] },
      paths: {},
    });
    expect(handle).toBeNull();
    expect(startAgentFileRetentionSweep).not.toHaveBeenCalled();
  });

  it('starts the sweep with the configured rules, interval and dryRun', () => {
    startAgentFileRetention({
      fileRetention: {
        agents: [{ agentId: 'a', retentionHours: 8 }],
        intervalMs: 3600000,
        dryRun: true,
      },
      paths: { uploads: '/app/uploads' },
    });
    expect(startAgentFileRetentionSweep).toHaveBeenCalledTimes(1);
    const [options, deps] = startAgentFileRetentionSweep.mock.calls[0];
    expect(options).toEqual({
      rules: [{ agentId: 'a', retentionHours: 8 }],
      intervalMs: 3600000,
      dryRun: true,
    });
    expect(typeof deps.getExpiredAgentUploads).toBe('function');
    expect(typeof deps.deleteDiskFile).toBe('function');
  });
});
