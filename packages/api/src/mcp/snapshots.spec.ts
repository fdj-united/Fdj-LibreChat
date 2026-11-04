import mongoose, { Types } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createModels, createMethods } from '@librechat/data-schemas';
import type { LCAvailableTools } from './types';
import {
  isLazyOAuthServer,
  createMCPToolSnapshots,
  loadDeferredMCPServerTools,
  MCP_TOOL_SNAPSHOT_TOKEN_TYPE,
} from './snapshots';

let mongo: MongoMemoryServer;
let methods: ReturnType<typeof createMethods>;

const jiraTools: LCAvailableTools = {
  searchJiraIssues_mcp_jira: {
    type: 'function',
    function: {
      name: 'searchJiraIssues_mcp_jira',
      description: 'Search Jira issues',
      parameters: { type: 'object', properties: { jql: { type: 'string' } } },
    },
  },
};

function setup() {
  const createToken = jest.fn(methods.createToken);
  const snapshots = createMCPToolSnapshots({
    findToken: methods.findToken,
    createToken,
    deleteTokens: methods.deleteTokens,
  });
  return { snapshots, createToken };
}

beforeAll(async () => {
  mongo = await MongoMemoryServer.create({ instance: { args: ['--nounixsocket'] } });
  await mongoose.connect(mongo.getUri());
  createModels(mongoose);
  methods = createMethods(mongoose);
});

afterEach(async () => {
  await mongoose.models.Token.deleteMany({});
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

describe('isLazyOAuthServer', () => {
  it('accepts servers that require OAuth or declare an oauth block', () => {
    expect(isLazyOAuthServer({ requiresOAuth: true })).toBe(true);
    expect(isLazyOAuthServer({ oauth: { scope: 'read:jira-work' } })).toBe(true);
  });

  it('rejects servers that do not use OAuth', () => {
    expect(isLazyOAuthServer({ requiresOAuth: false })).toBe(false);
    expect(isLazyOAuthServer({ oauth: {}, requiresOAuth: false })).toBe(false);
    expect(isLazyOAuthServer({})).toBe(false);
    expect(isLazyOAuthServer(undefined)).toBe(false);
  });
});

describe('createMCPToolSnapshots', () => {
  it('round-trips the definitions per user and server', async () => {
    const userId = new Types.ObjectId().toString();
    const otherUser = new Types.ObjectId().toString();
    const { snapshots } = setup();

    await snapshots.save(userId, 'jira', jiraTools);

    expect(await snapshots.load(userId, 'jira')).toEqual(jiraTools);
    expect(await snapshots.load(userId, 'confluence')).toBeNull();
    expect(await snapshots.load(otherUser, 'jira')).toBeNull();
  });

  it('keeps one record per user and server and skips unchanged rewrites', async () => {
    const userId = new Types.ObjectId().toString();
    const { snapshots, createToken } = setup();

    await snapshots.save(userId, 'jira', jiraTools);
    await snapshots.save(userId, 'jira', jiraTools);
    const changed: LCAvailableTools = {
      ...jiraTools,
      getJiraIssue_mcp_jira: {
        type: 'function',
        function: {
          name: 'getJiraIssue_mcp_jira',
          description: 'Get issue',
          parameters: { type: 'object' },
        },
      },
    };
    await snapshots.save(userId, 'jira', changed);

    expect(createToken).toHaveBeenCalledTimes(2);
    const records = await mongoose.models.Token.find({ type: MCP_TOOL_SNAPSHOT_TOKEN_TYPE });
    expect(records).toHaveLength(1);
    expect(await snapshots.load(userId, 'jira')).toEqual(changed);
  });

  it('ignores empty or malformed definitions on save', async () => {
    const userId = new Types.ObjectId().toString();
    const { snapshots, createToken } = setup();

    await snapshots.save(userId, 'jira', {});
    await snapshots.save(userId, 'jira', { bad: {} } as unknown as LCAvailableTools);

    expect(createToken).not.toHaveBeenCalled();
  });

  it('discards an unreadable stored snapshot', async () => {
    const userId = new Types.ObjectId().toString();
    const { snapshots } = setup();
    await methods.createToken({
      userId,
      type: MCP_TOOL_SNAPSHOT_TOKEN_TYPE,
      identifier: 'mcp:jira:tools',
      token: 'not json',
      expiresIn: 60,
    });

    expect(await snapshots.load(userId, 'jira')).toBeNull();
    expect(await mongoose.models.Token.countDocuments({})).toBe(0);
  });

  it('removes the stored snapshot', async () => {
    const userId = new Types.ObjectId().toString();
    const { snapshots } = setup();
    await snapshots.save(userId, 'jira', jiraTools);

    await snapshots.remove(userId, 'jira');

    expect(await snapshots.load(userId, 'jira')).toBeNull();
  });
});

describe('loadDeferredMCPServerTools', () => {
  it('returns the stored definitions', async () => {
    const userId = new Types.ObjectId().toString();
    const { snapshots } = setup();
    await snapshots.save(userId, 'jira', jiraTools);

    await expect(
      loadDeferredMCPServerTools({ userId, serverName: 'jira', snapshots }),
    ).resolves.toEqual(jiraTools);
  });

  it('falls back to regular discovery when the snapshot store fails', async () => {
    const snapshots = {
      load: jest.fn().mockRejectedValue(new Error('mongo down')),
      save: jest.fn(),
      remove: jest.fn(),
    };

    await expect(
      loadDeferredMCPServerTools({ userId: 'u1', serverName: 'jira', snapshots }),
    ).resolves.toBeNull();
  });
});
