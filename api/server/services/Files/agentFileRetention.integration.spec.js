/**
 * End-to-end integration for per-agent disk-only file retention, exercising the
 * REAL identification query and the REAL disk deleter against an in-memory
 * MongoDB and a real temp filesystem. Proves the two hard guarantees:
 *   1. only the target agent's expired `/uploads` files are removed from disk;
 *   2. NOTHING is removed from the database — `files`, `messages`, and
 *      `transactions` records are all left intact (so KPI pipelines that read
 *      `messages` / `transactions` are unaffected).
 */
const os = require('os');
const path = require('path');
const fs = require('fs');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

jest.mock('@librechat/data-schemas', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } }));
jest.mock('@librechat/api', () => ({ sweepAgentFiles: jest.fn(), startAgentFileRetentionSweep: jest.fn() }));

const { getExpiredAgentUploads, createDeleteDiskFile } = require('./agentFileRetention');

const HOUR = 60 * 60 * 1000;
const AGENT = 'agent_target';
const OTHER_AGENT = 'agent_other';

let mongoServer;
let uploadsBase;

const Conversation = mongoose.model(
  'Conversation',
  new mongoose.Schema({ conversationId: String, agent_id: String }, { strict: false }),
);
const Message = mongoose.model(
  'Message',
  new mongoose.Schema(
    { conversationId: String, files: Array, attachments: Array },
    { strict: false },
  ),
);
const File = mongoose.model(
  'File',
  new mongoose.Schema(
    { file_id: String, source: String, filepath: String, user: String, createdAt: Date },
    { strict: false, timestamps: false },
  ),
);
const Transaction = mongoose.model(
  'Transaction',
  new mongoose.Schema({ user: String, tokenValue: Number }, { strict: false }),
);

/** Write a physical file and return its stored `/uploads/...` filepath. */
function seedDiskFile(user, fileId, name) {
  const dir = path.join(uploadsBase, user);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${fileId}__${name}`), 'x');
  return `/uploads/${user}/${fileId}__${name}`;
}

beforeAll(async () => {
  // Prefer an externally provided Mongo (CI / local container); fall back to an
  // in-memory server when the download is available.
  const externalUri = process.env.MONGO_TEST_URI;
  const uri = externalUri || (mongoServer = await MongoMemoryServer.create()).getUri();
  await mongoose.connect(uri, { dbName: 'lc_retention_it' });
});

afterAll(async () => {
  await mongoose.disconnect();
  if (mongoServer) {
    await mongoServer.stop();
  }
  if (uploadsBase) {
    fs.rmSync(uploadsBase, { recursive: true, force: true });
  }
});

beforeEach(async () => {
  uploadsBase = fs.mkdtempSync(path.join(os.tmpdir(), 'lc-int-uploads-'));
  await Promise.all([
    Conversation.deleteMany({}),
    Message.deleteMany({}),
    File.deleteMany({}),
    Transaction.deleteMany({}),
  ]);
});

describe('agent disk retention — end to end', () => {
  it('identifies and disk-deletes only the target agent’s expired uploads, preserving all DB records', async () => {
    const now = Date.now();
    const old = new Date(now - 10 * HOUR); // past an 8h retention
    const recent = new Date(now - 1 * HOUR); // within retention

    // --- target agent conversation with two uploads: one old, one recent ---
    await Conversation.create({ conversationId: 'c1', agent_id: AGENT });
    const oldPath = seedDiskFile('u1', 'old1', 'statement.pdf');
    const recentPath = seedDiskFile('u1', 'recent1', 'fresh.pdf');
    await Message.create({
      conversationId: 'c1',
      files: [{ file_id: 'old1' }, { file_id: 'recent1' }],
    });
    await File.create([
      { file_id: 'old1', source: 'local', filepath: oldPath, user: 'u1', createdAt: old },
      { file_id: 'recent1', source: 'local', filepath: recentPath, user: 'u1', createdAt: recent },
    ]);

    // --- a DIFFERENT agent's old upload (must NOT be touched) ---
    await Conversation.create({ conversationId: 'c2', agent_id: OTHER_AGENT });
    const otherPath = seedDiskFile('u2', 'other1', 'other.pdf');
    await Message.create({ conversationId: 'c2', attachments: [{ file_id: 'other1' }] });
    await File.create({ file_id: 'other1', source: 'local', filepath: otherPath, user: 'u2', createdAt: old });

    // --- an old IMAGE upload in the target agent's convo (path not /uploads/, must NOT match) ---
    const imgDir = path.join(uploadsBase, '..', 'images-u1');
    fs.mkdirSync(imgDir, { recursive: true });
    await Message.create({ conversationId: 'c1', files: [{ file_id: 'img1' }] });
    await File.create({
      file_id: 'img1',
      source: 'local',
      filepath: '/images/u1/img1__pic.png',
      user: 'u1',
      createdAt: old,
    });

    // --- an old S3 (non-local) upload in the target convo (must NOT match) ---
    await Message.create({ conversationId: 'c1', files: [{ file_id: 's3a' }] });
    await File.create({
      file_id: 's3a',
      source: 's3',
      filepath: '/uploads/u1/s3a__remote.pdf',
      user: 'u1',
      createdAt: old,
    });

    // --- KPI collections: a transaction + the messages above already exist ---
    await Transaction.create({ user: 'u1', tokenValue: -1234 });

    const filesBefore = await File.countDocuments({});
    const messagesBefore = await Message.countDocuments({});
    const txBefore = await Transaction.countDocuments({});

    // --- run the REAL identification against an 8h cutoff ---
    const cutoff = new Date(now - 8 * HOUR);
    const candidates = await getExpiredAgentUploads(AGENT, cutoff);

    // Only the target agent's OLD, LOCAL, /uploads file is a candidate.
    expect(candidates.map((c) => c.file_id).sort()).toEqual(['old1']);

    // --- run the REAL disk deletion ---
    const deleteDiskFile = createDeleteDiskFile(uploadsBase);
    for (const c of candidates) {
      expect(await deleteDiskFile(c)).toBe('deleted');
    }

    // --- disk assertions ---
    expect(fs.existsSync(path.join(uploadsBase, 'u1', 'old1__statement.pdf'))).toBe(false); // deleted
    expect(fs.existsSync(path.join(uploadsBase, 'u1', 'recent1__fresh.pdf'))).toBe(true); // within retention
    expect(fs.existsSync(path.join(uploadsBase, 'u2', 'other1__other.pdf'))).toBe(true); // other agent

    // --- DB assertions: NOTHING deleted from any collection ---
    expect(await File.countDocuments({})).toBe(filesBefore); // file record preserved (disk-only)
    expect(await File.findOne({ file_id: 'old1' })).not.toBeNull(); // the deleted-on-disk file's record remains
    expect(await Message.countDocuments({})).toBe(messagesBefore); // KPI: messages untouched
    expect(await Transaction.countDocuments({})).toBe(txBefore); // KPI: transactions untouched
  });

  it('returns no candidates for an agent with no conversations', async () => {
    expect(await getExpiredAgentUploads('agent_nonexistent', new Date())).toEqual([]);
  });

  it('re-running after deletion is idempotent (candidate re-found, delete reports missing)', async () => {
    const old = new Date(Date.now() - 10 * HOUR);
    await Conversation.create({ conversationId: 'c1', agent_id: AGENT });
    const p = seedDiskFile('u1', 'old1', 'a.pdf');
    await Message.create({ conversationId: 'c1', files: [{ file_id: 'old1' }] });
    await File.create({ file_id: 'old1', source: 'local', filepath: p, user: 'u1', createdAt: old });

    const cutoff = new Date(Date.now() - 8 * HOUR);
    const deleteDiskFile = createDeleteDiskFile(uploadsBase);

    let candidates = await getExpiredAgentUploads(AGENT, cutoff);
    expect(await deleteDiskFile(candidates[0])).toBe('deleted');

    // second pass: the record still exists so it is re-found, but the file is gone
    candidates = await getExpiredAgentUploads(AGENT, cutoff);
    expect(candidates).toHaveLength(1);
    expect(await deleteDiskFile(candidates[0])).toBe('missing');
  });
});
