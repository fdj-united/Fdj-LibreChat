import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { getInsightsConfig } from 'librechat-data-provider';
import { createTransactionModel } from '../models/transaction';
import { createConversationModel } from '../models/convo';
import { createMessageModel } from '../models/message';
import { createInsightsMethods } from './insights';
import { createUserModel } from '../models/user';
import { getInsightsCost } from './cost';

let server: MongoMemoryServer;
const user = new mongoose.Types.ObjectId();
const createdAt = new Date('2026-11-05T12:00:00Z');
const agents = [
  { id: 'native', name: 'Native', provider: 'bedrock' },
  { id: 'studio', name: 'Studio', provider: 'AI Studio' },
];
const options = {
  from: new Date('2026-11-01T00:00:00Z'),
  to: new Date('2026-11-06T23:59:59Z'),
  tenantId: 'tenant-a',
  timeZone: 'UTC',
  agents,
  config: getInsightsConfig().cost,
};

beforeAll(async () => {
  server = await MongoMemoryServer.create();
  await mongoose.connect(server.getUri());
  await Promise.all([
    createTransactionModel(mongoose).init(),
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
  await Promise.all(Object.values(mongoose.models).map((model) => model.deleteMany({})));
  await mongoose.models.Conversation.collection.insertMany(
    ['native', 'studio', 'private'].map((agent) => ({
      conversationId: agent,
      agent_id: agent,
      user: user.toString(),
      tenantId: 'tenant-a',
      createdAt,
    })),
  );
  await mongoose.models.Message.collection.insertMany(
    ['native', 'studio', 'private'].map((agent) => ({
      messageId: agent,
      conversationId: agent,
      model: agent,
      user: user.toString(),
      tenantId: 'tenant-a',
      createdAt,
      isCreatedByUser: false,
    })),
  );
});

async function charge(overrides: Record<string, unknown> = {}) {
  return mongoose.models.Transaction.collection.insertOne({
    user,
    tenantId: 'tenant-a',
    createdAt,
    conversationId: 'native',
    messageId: 'native',
    tokenType: 'prompt',
    context: 'message',
    tokenValue: -100000,
    ...overrides,
  });
}

it('sums stored input/cache and output charges, including title and subagent calls, once', async () => {
  await charge({ inputTokens: 10, writeTokens: 20, readTokens: 30 });
  await charge({ tokenType: 'completion', tokenValue: -200000 });
  await charge({ context: 'title', tokenValue: -10000 });
  await charge({ context: 'subagent', tokenValue: -40000 });
  await charge({ tokenType: 'credits', tokenValue: 999999999 });
  const result = await getInsightsCost(mongoose, { ...options, agents: [agents[0]] });
  expect(result).toEqual({
    status: 'available',
    currency: 'USD',
    total: 0.35,
    excludedAgents: 0,
    daily: [{ date: '2026-11-05', total: 0.35 }],
  });
});

it('shows N/A for AI Studio even if it has nonzero or zero ledger charges, without a cost query', async () => {
  await charge({ conversationId: 'studio', messageId: 'studio', tokenValue: -999999999 });
  const spy = jest.spyOn(mongoose.models.Transaction, 'aggregate');
  const result = await getInsightsCost(mongoose, { ...options, agents: [agents[1]] });
  expect(result.total).toBeNull();
  expect(result.status).toBe('unavailable');
  expect(result.daily).toEqual([]);
  expect(spy).not.toHaveBeenCalled();
});

it('returns only the known subtotal for mixed selections', async () => {
  await charge();
  await charge({ conversationId: 'studio', messageId: 'studio', tokenValue: -999999999 });
  const result = await getInsightsCost(mongoose, options);
  expect(result).toMatchObject({ status: 'partial', total: 0.1, excludedAgents: 1 });
});

it('applies the requested agent selection before classifying availability in the dashboard', async () => {
  await charge();
  const result = await createInsightsMethods(mongoose).getInsights({
    tenantId: 'tenant-a',
    agents,
    agentIds: ['studio'],
    range: 'custom',
    fromTimestamp: options.from.toISOString(),
    toTimestamp: options.to.toISOString(),
    insights: getInsightsConfig({ cost: { enabled: true } }),
  });
  expect(result.cost).toMatchObject({ status: 'unavailable', total: null, excludedAgents: 1 });
});

it('does not treat an unknown provider or an empty authorized scope as free usage', async () => {
  for (const selected of [[], [{ id: 'native', name: 'Unknown provider' }]]) {
    expect(await getInsightsCost(mongoose, { ...options, agents: selected })).toMatchObject({
      status: 'unavailable',
      total: null,
    });
  }
});

it('allows configured unavailable providers and normalizes provider names', async () => {
  const config = getInsightsConfig({ cost: { unavailableProviders: ['BEDROCK'] } }).cost;
  const result = await getInsightsCost(mongoose, { ...options, agents: [agents[0]], config });
  expect(result.status).toBe('unavailable');
});

it('returns zero only for an eligible agent with no recorded charges', async () => {
  expect(await getInsightsCost(mongoose, { ...options, agents: [agents[0]] })).toMatchObject({
    status: 'available',
    total: 0,
  });
});

it('does not duplicate charges when another tenant has matching public message and conversation ids', async () => {
  await charge();
  await mongoose.models.Message.collection.insertOne({
    messageId: 'native',
    conversationId: 'native',
    model: 'native',
    user: user.toString(),
    tenantId: 'tenant-b',
    createdAt,
    isCreatedByUser: false,
  });
  await mongoose.models.Conversation.collection.insertOne({
    conversationId: 'native',
    agent_id: 'native',
    user: user.toString(),
    tenantId: 'tenant-b',
    createdAt,
  });
  expect((await getInsightsCost(mongoose, options)).total).toBe(0.1);
});

it('rejects transactions outside date, tenant, message ownership, conversation or permitted agents', async () => {
  await charge();
  await charge({ createdAt: new Date('2026-10-01') });
  await charge({ tenantId: 'tenant-b' });
  await charge({ user: new mongoose.Types.ObjectId() });
  await charge({ conversationId: 'studio' });
  await charge({ messageId: 'missing' });
  await charge({ conversationId: 'private', messageId: 'private' });
  expect((await getInsightsCost(mongoose, options)).total).toBe(0.1);
});

it.each([
  'messageTemporary',
  'conversationTemporary',
  'childConversation',
  'conversationOwner',
  'messageTenant',
  'conversationTenant',
  'nonAgentConversation',
])('excludes %s', async (scenario) => {
  await charge();
  if (scenario === 'messageTemporary')
    await mongoose.models.Message.updateOne({ messageId: 'native' }, { isTemporary: true });
  if (scenario === 'messageTenant')
    await mongoose.models.Message.collection.updateOne(
      { messageId: 'native' },
      { $set: { tenantId: 'tenant-b' } },
    );
  if (scenario === 'conversationTenant')
    await mongoose.models.Conversation.collection.updateOne(
      { conversationId: 'native' },
      { $set: { tenantId: 'tenant-b' } },
    );
  if (scenario === 'conversationTemporary')
    await mongoose.models.Conversation.updateOne(
      { conversationId: 'native' },
      { isTemporary: true },
    );
  if (scenario === 'childConversation')
    await mongoose.models.Conversation.collection.updateOne(
      { conversationId: 'native' },
      { $set: { subagentThread: { rootConversationId: 'parent' } } },
    );
  if (scenario === 'conversationOwner')
    await mongoose.models.Conversation.updateOne(
      { conversationId: 'native' },
      { user: new mongoose.Types.ObjectId().toString() },
    );
  if (scenario === 'nonAgentConversation')
    await mongoose.models.Conversation.collection.updateOne(
      { conversationId: 'native' },
      { $unset: { agent_id: '', initial_agent_id: '' } },
    );
  expect((await getInsightsCost(mongoose, options)).total).toBe(0);
});

it('groups by the viewer timezone using the transaction date', async () => {
  await charge({ createdAt: new Date('2026-11-05T01:00:00Z') });
  const result = await getInsightsCost(mongoose, { ...options, timeZone: 'America/New_York' });
  expect(result.daily[0].date).toBe('2026-11-04');
});

it('keeps the query disabled by default and propagates database failures instead of reporting zero', async () => {
  const spy = jest.spyOn(mongoose.models.Transaction, 'aggregate');
  const result = await createInsightsMethods(mongoose).getInsights({
    ...options,
    agentIds: ['native'],
    range: 'custom',
    fromTimestamp: options.from.toISOString(),
    toTimestamp: options.to.toISOString(),
  });
  expect(result).not.toHaveProperty('cost');
  expect(spy).not.toHaveBeenCalled();
  spy.mockImplementationOnce(() => {
    throw new Error('database unavailable');
  });
  await expect(getInsightsCost(mongoose, options)).rejects.toThrow('database unavailable');
});
