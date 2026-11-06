import type { TInsightsAgent, TInsightsConfig, TInsightsCost } from 'librechat-data-provider';
import type { Model, PipelineStage } from 'mongoose';
import type { ITransaction } from '~/schema/transaction';

type CostOptions = {
  from: Date;
  to: Date;
  tenantId?: string;
  timeZone: string;
  agents: TInsightsAgent[];
  config: TInsightsConfig['cost'];
};

/** Recorded ledger cost only. Provider exclusions must be applied before querying charges. */
export async function getInsightsCost(
  mongoose: typeof import('mongoose'),
  { from, to, tenantId, timeZone, agents, config }: CostOptions,
): Promise<TInsightsCost> {
  const unavailable = new Set(
    config.unavailableProviders.map((provider) => provider.toLowerCase()),
  );
  const eligible = agents.filter((agent) => {
    const provider = agent.provider?.trim().toLowerCase();
    return provider && !unavailable.has(provider);
  });
  const excludedAgents = agents.length - eligible.length;
  if (eligible.length === 0) {
    return { status: 'unavailable', currency: 'USD', total: null, excludedAgents, daily: [] };
  }

  const tenant = tenantId ?? { $exists: false };
  const pipeline: PipelineStage[] = [
    {
      $match: {
        tenantId: tenant,
        createdAt: { $gte: from, $lte: to },
        tokenType: { $in: ['prompt', 'completion'] },
      },
    },
    { $project: { user: 1, createdAt: 1, messageId: 1, conversationId: 1, tokenValue: 1 } },
    {
      $lookup: {
        from: 'messages',
        localField: 'messageId',
        foreignField: 'messageId',
        pipeline: [
          {
            $project: {
              user: 1,
              model: 1,
              conversationId: 1,
              tenantId: 1,
              isTemporary: 1,
              isCreatedByUser: 1,
            },
          },
        ],
        as: 'costMessage',
      },
    },
    { $unwind: '$costMessage' },
    {
      $match: {
        'costMessage.tenantId': tenant,
        'costMessage.model': { $in: eligible.map((agent) => agent.id) },
        'costMessage.isTemporary': { $ne: true },
        'costMessage.isCreatedByUser': { $ne: true },
        $expr: {
          $and: [
            { $eq: [{ $toString: '$user' }, '$costMessage.user'] },
            { $eq: ['$conversationId', '$costMessage.conversationId'] },
          ],
        },
      },
    },
    {
      $lookup: {
        from: 'conversations',
        localField: 'conversationId',
        foreignField: 'conversationId',
        pipeline: [
          {
            $project: {
              user: 1,
              tenantId: 1,
              isTemporary: 1,
              subagentThread: 1,
              initial_agent_id: 1,
              agent_id: 1,
            },
          },
        ],
        as: 'costConversation',
      },
    },
    { $unwind: '$costConversation' },
    {
      $match: {
        'costConversation.tenantId': tenant,
        'costConversation.isTemporary': { $ne: true },
        'costConversation.subagentThread': { $exists: false },
        $expr: { $eq: [{ $toString: '$user' }, '$costConversation.user'] },
        $or: [
          { 'costConversation.initial_agent_id': { $exists: true, $nin: [null, ''] } },
          {
            'costConversation.initial_agent_id': { $exists: false },
            'costConversation.agent_id': { $exists: true, $nin: [null, ''] },
          },
        ],
      },
    },
    {
      $group: {
        _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: timeZone } },
        credits: { $sum: '$tokenValue' },
      },
    },
    {
      $project: {
        _id: 0,
        date: '$_id',
        total: { $divide: [{ $multiply: ['$credits', -1] }, 1e6] },
      },
    },
    { $sort: { date: 1 } },
  ];
  const Transaction = mongoose.models.Transaction as Model<ITransaction>;
  const daily = await Transaction.aggregate<TInsightsCost['daily'][number]>(pipeline).option({
    maxTimeMS: config.maxTimeMS,
  });
  return {
    status: excludedAgents > 0 ? 'partial' : 'available',
    currency: 'USD',
    total: daily.reduce((sum, day) => sum + day.total, 0),
    excludedAgents,
    daily,
  };
}
