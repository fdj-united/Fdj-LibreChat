import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { getInsightsConfig, INSIGHTS_UNCATEGORIZED } from 'librechat-data-provider';
import { createConversationModel } from '../models/convo';
import { createMessageModel } from '../models/message';
import { createInsightsMethods } from './insights';
import { createUserModel } from '../models/user';

let server: MongoMemoryServer;
const user = new mongoose.Types.ObjectId().toString();

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

it('omits private message text from both the database read and response', async () => {
  const createdAt = new Date(Date.now() - 3600000);
  await mongoose.models.Conversation.collection.insertOne({
    conversationId: 'privacy-chat',
    agent_id: 'agent-a',
    tenantId: 'tenant-a',
    user,
    createdAt,
  });
  await mongoose.models.Message.collection.insertOne({
    messageId: 'private-prompt',
    conversationId: 'privacy-chat',
    tenantId: 'tenant-a',
    user,
    isCreatedByUser: true,
    text: 'private content must not be returned',
    createdAt,
  });
  const spy = jest.spyOn(mongoose.models.Message, 'aggregate');
  const getInsights = createInsightsMethods(mongoose).getInsights;
  const options = {
    tenantId: 'tenant-a',
    agents: [{ id: 'agent-a', name: 'Alpha' }],
    agentIds: ['agent-a'],
  };
  try {
    const result = await getInsights({
      ...options,
      insights: getInsightsConfig({ privacy: { includeFirstMessage: false } }),
    });
    expect(result.latest.conversations).toHaveLength(1);
    expect(result.latest.conversations[0]).not.toHaveProperty('firstMessage');
    expect(JSON.stringify(result)).not.toContain('private content');
    expect(spy.mock.calls.some(([pipeline]) => JSON.stringify(pipeline).includes('$text'))).toBe(
      false,
    );
  } finally {
    spy.mockRestore();
  }
  const legacy = await getInsights(options);
  expect(legacy.latest.conversations[0].firstMessage).toBe('private content must not be returned');
  expect(legacy).not.toHaveProperty('breakdowns');
});

it('keeps breakdown totals consistent with primary-agent attribution and existing scope rules', async () => {
  const createdAt = new Date(Date.now() - 3600000);
  const base = { tenantId: 'tenant-a', user, createdAt };
  await mongoose.models.Conversation.collection.insertMany([
    { ...base, conversationId: 'a', initial_agent_id: 'agent-a', agent_id: 'agent-b' },
    { ...base, conversationId: 'b', agent_id: 'agent-b' },
    { ...base, conversationId: 'c', agent_id: 'agent-c' },
    { ...base, conversationId: 'unauthorized', agent_id: 'agent-private' },
    { ...base, conversationId: 'other-tenant', agent_id: 'agent-a', tenantId: 'tenant-b' },
    { ...base, conversationId: 'temporary', agent_id: 'agent-a', isTemporary: true },
    {
      ...base,
      conversationId: 'child',
      agent_id: 'agent-a',
      subagentThread: { rootConversationId: 'a' },
    },
    {
      ...base,
      conversationId: 'old',
      agent_id: 'agent-a',
      createdAt: new Date(Date.now() - 40 * 86400000),
    },
  ]);
  const result = await createInsightsMethods(mongoose).getInsights({
    tenantId: 'tenant-a',
    range: '24h',
    agentIds: ['agent-a', 'agent-b', 'agent-c'],
    agents: [
      { id: 'agent-a', name: 'Alpha', category: 'hr' },
      { id: 'agent-b', name: 'Beta', category: 'HR' },
      { id: 'agent-c', name: 'Gamma' },
    ],
    insights: getInsightsConfig({
      privacy: { includeFirstMessage: false },
      filters: { categories: true },
      charts: { usageByAgent: true, usageByCategory: true },
      categoryAliases: { hr: 'HR' },
    }),
  });
  expect(result.summary.totalConversations).toBe(3);
  expect(result.breakdowns?.agents).toEqual([
    { id: 'agent-a', label: 'Alpha', conversations: 1 },
    { id: 'agent-b', label: 'Beta', conversations: 1 },
    { id: 'agent-c', label: 'Gamma', conversations: 1 },
  ]);
  expect(result.breakdowns?.categories).toEqual([
    { id: 'HR', label: 'HR', conversations: 2 },
    { id: INSIGHTS_UNCATEGORIZED, label: INSIGHTS_UNCATEGORIZED, conversations: 1 },
  ]);
  expect(result.categories).toEqual([INSIGHTS_UNCATEGORIZED, 'HR'].sort());
  for (const rows of Object.values(result.breakdowns ?? {})) {
    expect(rows.reduce((sum, row) => sum + row.conversations, 0)).toBe(
      result.summary.totalConversations,
    );
  }
});
