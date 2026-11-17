import path from 'node:path';
import mongoose from 'mongoose';
import { readFileSync } from 'node:fs';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { getInsightsConfig } from 'librechat-data-provider';
import { createConversationModel } from '../models/convo';
import { createMessageModel } from '../models/message';
import { createInsightsMethods } from './insights';
import { createUserModel } from '../models/user';

let server: MongoMemoryServer;
const owner = '000000000000000000000001';
const another = '000000000000000000000002';
const tenant = 'tenant-a';
const at = (day: number) => new Date(Date.UTC(2026, 10, day, 12));
const config = getInsightsConfig({
  privacy: { includeFirstMessage: false },
  metrics: { engagement: true },
  maxRangeDays: 90,
});
const get = (from: number, to: number, agentIds = ['agent-a']) =>
  createInsightsMethods(mongoose).getInsights({
    range: 'custom',
    fromTimestamp: new Date(Date.UTC(2026, 10, from)).toISOString(),
    toTimestamp: new Date(Date.UTC(2026, 10, to) - 1).toISOString(),
    tenantId: tenant,
    timeZone: 'UTC',
    agentIds,
    agents: agentIds.map((id) => ({ id, name: id })),
    insights: config,
  });

beforeAll(async () => {
  server = await MongoMemoryServer.create();
  await mongoose.connect(server.getUri());
  await Promise.all([
    createConversationModel(mongoose).init(),
    createMessageModel(mongoose).init(),
    createUserModel(mongoose).init(),
  ]);
});
afterAll(async () => {
  await mongoose.disconnect();
  await server.stop();
});
beforeEach(async () => {
  await Promise.all([
    mongoose.models.Conversation.deleteMany({}),
    mongoose.models.Message.deleteMany({}),
    mongoose.models.User.deleteMany({}),
  ]);
});

async function chat(id: string, date = at(1), overrides = {}) {
  await mongoose.models.Conversation.collection.insertOne({
    conversationId: id,
    user: owner,
    createdAt: date,
    initial_agent_id: 'agent-a',
    tenantId: tenant,
    ...overrides,
  });
}
async function question(id: string, conversationId: string, day = 1, overrides = {}) {
  await mongoose.models.Message.collection.insertOne({
    messageId: id,
    conversationId,
    user: owner,
    createdAt: at(day),
    isCreatedByUser: true,
    tenantId: tenant,
    tokenCount: 2,
    text: 'PRIVATE',
    ...overrides,
  });
}
async function reply(
  id: string,
  parentMessageId: string,
  conversationId: string,
  day = 1,
  overrides = {},
) {
  await mongoose.models.Message.collection.insertOne({
    messageId: id,
    parentMessageId,
    conversationId,
    user: owner,
    createdAt: at(day),
    isCreatedByUser: false,
    model: 'agent-a',
    tenantId: tenant,
    tokenCount: 3,
    ...overrides,
  });
}

it('counts a user message once, sums selected replies, and does not shift it to the reply date', async () => {
  await chat('repeat');
  await question('q', 'repeat');
  await reply('a1', 'q', 'repeat', 2);
  await reply('a2', 'q', 'repeat', 3, { tokenCount: 5 });
  const first = await get(1, 2);
  expect(first.summary).toEqual({
    totalConversations: 1,
    totalUsers: 1,
    totalMessages: 1,
    totalTokens: 10,
  });
  expect(first.engagement).toMatchObject({
    activeUsers: 1,
    activeConversations: 1,
    questions: 1,
    singleQuestionConversations: 1,
  });
  expect((await get(2, 4)).summary).toEqual({
    totalConversations: 0,
    totalUsers: 0,
    totalMessages: 0,
    totalTokens: 0,
  });
  expect(JSON.stringify(first)).not.toContain('PRIVATE');
});

it('treats missing or nonnumeric recorded token counts as zero', async () => {
  await chat('legacy-tokens');
  await question('q', 'legacy-tokens', 1, { tokenCount: 'unknown' });
  await reply('a', 'q', 'legacy-tokens', 1, { tokenCount: null });
  expect((await get(1, 2)).summary).toMatchObject({ totalMessages: 1, totalTokens: 0 });
});

it('counts separately submitted edits even when their question text is identical', async () => {
  await chat('edited');
  await question('original', 'edited', 1, { text: 'Same question' });
  await reply('first-answer', 'original', 'edited');
  await question('resubmitted', 'edited', 1, { text: 'Same question' });
  await reply('second-answer', 'resubmitted', 'edited');
  const result = await get(1, 2);
  expect(result.summary.totalMessages).toBe(2);
  expect(result.engagement).toMatchObject({
    activeConversations: 1,
    questions: 2,
    singleQuestionConversations: 0,
  });
});

it('counts one creation in X and only the follow-up message in Y', async () => {
  await chat('follow-up');
  await question('qx', 'follow-up');
  await reply('ax', 'qx', 'follow-up');
  await question('qy', 'follow-up', 11);
  await reply('ay', 'qy', 'follow-up', 11);
  const x = await get(1, 2);
  const y = await get(11, 12);
  expect(x.summary).toMatchObject({ totalConversations: 1, totalMessages: 1 });
  expect(y.summary).toMatchObject({ totalConversations: 0, totalMessages: 1, totalUsers: 1 });
  expect(y.engagement).toMatchObject({ activeConversations: 1, questions: 1 });
});

it('attributes through the responding agent, excludes unanswered questions, and deduplicates across selected agents', async () => {
  await chat('other-start', at(1), { initial_agent_id: 'agent-b' });
  await chat('other-reply');
  await chat('no-reply');
  await question('cross', 'other-start');
  await reply('cross-a', 'cross', 'other-start');
  await reply('cross-b', 'cross', 'other-start', 1, { model: 'agent-b' });
  await question('wrong', 'other-reply');
  await reply('wrong-answer', 'wrong', 'other-reply', 1, { model: 'agent-b' });
  await question('pending', 'no-reply');
  expect((await get(1, 2)).summary).toMatchObject({
    totalConversations: 2,
    totalUsers: 1,
    totalMessages: 1,
    totalTokens: 5,
  });
  expect((await get(1, 2, ['agent-a', 'agent-b'])).summary).toMatchObject({
    totalConversations: 3,
    totalMessages: 2,
    totalTokens: 13,
  });
});

it('rejects wrong owners, other tenants, temporary and child parents, and forged reply links', async () => {
  const cases = [
    ['owner', { user: another }],
    ['tenant', { tenantId: 'tenant-b' }],
    ['temp', { isTemporary: true }],
    ['child', { subagentThread: {} }],
  ] as const;
  for (const [id, override] of cases) {
    await chat(id, at(1), override);
    await question(`q-${id}`, id);
    await reply(`a-${id}`, `q-${id}`, id);
  }
  await chat('valid');
  await question('q-valid', 'valid');
  await reply('wrong-user', 'q-valid', 'valid', 1, { user: another });
  await reply('wrong-tenant', 'q-valid', 'valid', 1, { tenantId: 'tenant-b' });
  await reply('wrong-chat', 'q-valid', 'unrelated');
  await reply('temp-reply', 'q-valid', 'valid', 1, { isTemporary: true });
  const result = await get(1, 2);
  expect(result.summary.totalMessages).toBe(0);
  expect(result.summary.totalUsers).toBe(0);
});

it('deduplicates saved user-message IDs within their owner and conversation scope', async () => {
  // Legacy production data can predate the unique index. Only this isolated fixture drops it.
  await mongoose.models.Message.collection.dropIndex('messageId_1_user_1_tenantId_1');
  try {
    await chat('duplicate');
    await question('q', 'duplicate');
    await question('q', 'duplicate');
    await reply('a', 'q', 'duplicate');
    const result = await get(1, 2);
    expect(result.summary.totalMessages).toBe(1);
    expect(result.summary.totalTokens).toBe(5);
  } finally {
    await mongoose.models.Message.deleteMany({});
    await mongoose.models.Message.collection.createIndex(
      { messageId: 1, user: 1, tenantId: 1 },
      { unique: true },
    );
  }
});

it('matches the shared cross-language usage contract fixtures for both periods', async () => {
  const fixture = JSON.parse(readFileSync(path.join(__dirname, '__fixtures__/usage.json'), 'utf8'));
  const dated = (row: Record<string, unknown>) => ({
    ...row,
    createdAt: new Date(String(row.createdAt)),
  });
  await mongoose.models.Conversation.collection.insertMany(fixture.conversations.map(dated));
  await mongoose.models.Message.collection.insertMany(fixture.messages.map(dated));
  for (const window of fixture.windows) {
    const result = await createInsightsMethods(mongoose).getInsights({
      range: 'custom',
      fromTimestamp: window.from,
      toTimestamp: new Date(new Date(window.toExclusive).getTime() - 1).toISOString(),
      tenantId: fixture.tenant,
      timeZone: 'UTC',
      agentIds: window.agentIds ?? [fixture.agent],
      agents: (window.agentIds ?? [fixture.agent]).map((id: string) => ({ id, name: id })),
      insights: config,
    });
    expect(result.summary).toEqual(window.expected);
    expect(result.engagement).toMatchObject({
      activeConversations: window.activeConversations,
      singleQuestionConversations: window.singleQuestionConversations,
      questions: window.expected.totalMessages,
    });
  }
});
