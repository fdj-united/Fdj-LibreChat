import { z } from 'zod';
import type { DeepPartial } from '../config';

export const INSIGHTS_UNCATEGORIZED = '__uncategorized__';
export const INSIGHTS_MAX_RANGE_DAYS = 30;

export const insightsConfigSchema = z
  .object({
    privacy: z.object({ includeFirstMessage: z.boolean().default(true) }).default({}),
    filters: z.object({ categories: z.boolean().default(false) }).default({}),
    maxRangeDays: z.number().int().min(1).max(365).default(INSIGHTS_MAX_RANGE_DAYS),
    metrics: z.object({ engagement: z.boolean().default(false) }).default({}),
    charts: z
      .object({
        dailyUsage: z.boolean().default(false),
        /** Deprecated display controls, accepted for existing deployment configurations. */
        usageByAgent: z.boolean().default(false),
        usageByCategory: z.boolean().default(false),
        defaultBreakdownView: z.enum(['doughnut', 'bar']).default('doughnut'),
        topN: z.number().int().min(1).max(20).default(5),
      })
      .default({}),
    categoryAliases: z.record(z.string().trim().min(1)).default({}),
  })
  .default({});

export type TInsightsConfig = z.infer<typeof insightsConfigSchema>;
export type TInsightsDisplayConfig = Pick<
  TInsightsConfig,
  'privacy' | 'filters' | 'charts' | 'metrics' | 'maxRangeDays'
>;

export const getInsightsConfig = (config?: DeepPartial<TInsightsConfig>): TInsightsConfig =>
  insightsConfigSchema.parse(config);

export function getInsightsDisplayConfig(
  config?: DeepPartial<TInsightsConfig>,
): TInsightsDisplayConfig {
  const { privacy, filters, charts, metrics, maxRangeDays } = getInsightsConfig(config);
  return { privacy, filters, charts, metrics, maxRangeDays };
}

export function getInsightsCategory(
  category?: string,
  aliases: Record<string, string> = {},
): string {
  const value = category?.trim();
  if (!value) return INSIGHTS_UNCATEGORIZED;
  return Object.prototype.hasOwnProperty.call(aliases, value) ? aliases[value] : value;
}

export type InsightsRange = 'today' | '24h' | '7d' | '30d' | 'custom';

export const INSIGHTS_SEARCH_MIN_LENGTH = 3;
export const INSIGHTS_SEARCH_MAX_LENGTH = 200;
export const INSIGHTS_AGENT_ID_MAX_LENGTH = 256;
export type TInsightsParams = {
  range?: InsightsRange;
  fromTimestamp?: string;
  toTimestamp?: string;
  timeZone?: string;
  search?: string;
  agentIds?: string[];
  categories?: string[];
  page?: number;
  pageSize?: number;
};

export type TInsightsAgent = {
  id: string;
  name: string;
  category?: string;
};

export type TInsightsBreakdown = {
  id: string;
  label: string;
  conversations: number;
};

export type TInsightsDailyPoint = {
  date: string;
  conversations: number;
  users: number;
  messages: number;
  totalTokens: number;
};

export type TInsightsUser = {
  userId: string;
  name: string;
  email: string;
  conversations: number;
  messages: number;
};

export type TInsightsChurnedUser = TInsightsUser & {
  firstSeen: string;
  lastSeen: string;
};

export type TInsightsConversation = {
  conversationId: string;
  agentId: string;
  agentName: string;
  date: string;
  userId: string;
  name: string;
  email: string;
  firstMessage?: string;
  messages: number;
  totalTokens: number;
};

export type TInsightsSummary = {
  totalUsers: number;
  totalConversations: number;
  totalMessages: number;
  totalTokens: number;
};

export type TInsightsEngagement = {
  activeUsers: number;
  activeConversations: number;
  questions: number;
  singleQuestionConversations: number;
  activityDistribution: Array<{ bucket: '1' | '2–5' | '6–10' | '11–20' | '21+'; users: number }>;
};

export type TInsightsResponse = {
  agents: TInsightsAgent[];
  categories?: string[];
  breakdowns?: {
    agents?: TInsightsBreakdown[];
    categories?: TInsightsBreakdown[];
  };
  summary: TInsightsSummary;
  engagement?: TInsightsEngagement;
  daily: TInsightsDailyPoint[];
  topUsers: TInsightsUser[];
  churnedUsers: TInsightsChurnedUser[];
  latest: {
    conversations: TInsightsConversation[];
    page: number;
    pageSize: number;
    pages: number;
  };
};

export type TInsightsAccessResponse = {
  access: boolean;
};
