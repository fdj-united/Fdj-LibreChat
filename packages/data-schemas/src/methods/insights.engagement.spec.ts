import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { getInsightsConfig } from 'librechat-data-provider';
import type { InsightsOptions } from './insights';
import { createConversationModel } from '../models/convo';
import { createMessageModel } from '../models/message';
import { createInsightsMethods } from './insights';
import { createUserModel } from '../models/user';

let server: MongoMemoryServer;
const user = new mongoose.Types.ObjectId().toString();
const otherUser = new mongoose.Types.ObjectId().toString();
const hourAgo = () => new Date(Date.now() - 3_600_000);
const insights = getInsightsConfig({
  privacy: { includeFirstMessage: false },
  metrics: { engagement: true },
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
  ]);
});

const getInsights = (extra: Partial<InsightsOptions> = {}) =>
  createInsightsMethods(mongoose).getInsights({
    tenantId: 'tenant-a',
    agentIds: ['agent-a'],
    agents: [{ id: 'agent-a', name: 'Alpha' }],
    insights,
    ...extra,
  });

async function seedConversation(
  id: string,
  owner: string,
  questions: number,
  overrides = {},
  date = hourAgo(),
) {
  await mongoose.models.Conversation.collection.insertOne({
    conversationId: id,
    user: owner,
    agent_id: 'agent-a',
    createdAt: date,
    tenantId: 'tenant-a',
    ...overrides,
  });
  await mongoose.models.Message.collection.insertMany(
    Array.from({ length: questions }, (_, index) => ({
      conversationId: id,
      messageId: `${id}-${index}`,
      user: owner,
      isCreatedByUser: true,
      createdAt: date,
      tenantId: 'tenant-a',
      text: 'PRIVATE_QUESTION',
    })),
  );
}

it('counts questions in active chats with matching scope and ownership, including older chats', async () => {
  await seedConversation('first', user, 2, { initial_agent_id: 'agent-a', agent_id: 'agent-b' });
  await seedConversation('legacy', user, 1);
  await seedConversation('older', otherUser, 1, {
    createdAt: new Date(Date.now() - 40 * 86400000),
  });
  await seedConversation('unauthorized', user, 1, { agent_id: 'private-agent' });
  await seedConversation('other-tenant', user, 1, { tenantId: 'tenant-b' });
  await seedConversation('temporary', user, 1, { isTemporary: true });
  await seedConversation('child', user, 1, { subagentThread: { parent: 'first' } });
  await mongoose.models.Message.collection.insertMany([
    {
      conversationId: 'first',
      messageId: 'answer',
      user,
      isCreatedByUser: false,
      model: 'agent-a',
      createdAt: hourAgo(),
      tenantId: 'tenant-a',
    },
    {
      conversationId: 'older',
      messageId: 'wrong-owner',
      user,
      isCreatedByUser: true,
      createdAt: hourAgo(),
      tenantId: 'tenant-a',
    },
    {
      conversationId: 'legacy',
      messageId: 'outside-period',
      user,
      isCreatedByUser: true,
      createdAt: new Date(Date.now() - 10 * 86400000),
      tenantId: 'tenant-a',
    },
  ]);
  const result = await getInsights();
  expect(result.summary.totalConversations).toBe(2);
  expect(result.engagement).toEqual({
    activeUsers: 2,
    activeConversations: 3,
    questions: 4,
    singleQuestionConversations: 2,
    activityDistribution: [
      { bucket: '1', users: 1 },
      { bucket: '2–5', users: 1 },
      { bucket: '6–10', users: 0 },
      { bucket: '11–20', users: 0 },
      { bucket: '21+', users: 0 },
    ],
  });
  expect(JSON.stringify(result)).not.toContain('PRIVATE_QUESTION');
  expect(result).not.toHaveProperty('breakdowns');
});

it('places every boundary into exactly one activity bucket and deduplicates users across agents', async () => {
  const counts = [1, 2, 5, 6, 10, 11, 20, 21];
  for (const [index, count] of counts.entries()) {
    const owner = new mongoose.Types.ObjectId().toString();
    for (let chat = 0; chat < count; chat++)
      await seedConversation(`${index}-${chat}`, owner, 1, {
        agent_id: chat % 2 ? 'agent-b' : 'agent-a',
      });
  }
  const result = await getInsights({ agentIds: ['agent-a', 'agent-b'] });
  expect(result.engagement?.activeUsers).toBe(8);
  expect(result.engagement?.activeConversations).toBe(76);
  expect(result.engagement?.singleQuestionConversations).toBe(76);
  expect(result.engagement?.activityDistribution.map((row) => row.users)).toEqual([1, 2, 2, 2, 1]);
});

it('returns zero-valued engagement and skips the additional query when disabled', async () => {
  const result = await getInsights();
  expect(result.engagement?.questions).toBe(0);
  expect(result.engagement?.activeConversations).toBe(0);
  expect(result.engagement?.activityDistribution.every((row) => row.users === 0)).toBe(true);
  const spy = jest.spyOn(mongoose.models.Message, 'aggregate');
  try {
    const disabled = await getInsights({
      insights: getInsightsConfig({
        privacy: { includeFirstMessage: false },
        charts: { usageByAgent: true },
      }),
    });
    expect(disabled).not.toHaveProperty('engagement');
    expect(disabled).not.toHaveProperty('breakdowns');
    expect(
      spy.mock.calls.some(([pipeline]) =>
        JSON.stringify(pipeline).includes('singleQuestionConversations'),
      ),
    ).toBe(false);
  } finally {
    spy.mockRestore();
  }
});

it('allows a configured longer range while preserving the default 30-day bound', async () => {
  await seedConversation('historical', user, 1, {}, new Date(Date.now() - 45 * 86400000));
  const range = {
    range: 'custom' as const,
    fromTimestamp: new Date(Date.now() - 60 * 86400000).toISOString(),
    toTimestamp: new Date().toISOString(),
  };
  expect((await getInsights(range)).summary.totalConversations).toBe(0);
  const extended = await getInsights({
    ...range,
    insights: getInsightsConfig({ ...insights, maxRangeDays: 90 }),
  });
  expect(extended.summary.totalConversations).toBe(1);
  expect(extended.engagement?.questions).toBe(1);
});

it('starts Today at midnight in the requested timezone', async () => {
  const zone = 'Pacific/Kiritimati';
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const get = (key: string) => Number(parts.find((part) => part.type === key)!.value);
  const midnight = Date.UTC(get('year'), get('month') - 1, get('day')) - 14 * 3600000;
  await seedConversation('yesterday', user, 1, {}, new Date(midnight - 1000));
  await seedConversation('today', user, 1, {}, new Date(midnight + 1));
  const result = await getInsights({ range: 'today', timeZone: zone });
  expect(result.summary.totalConversations).toBe(1);
  expect(result.engagement?.questions).toBe(1);
  expect(result.daily).toHaveLength(1);
});
