import React from 'react';
import userEvent from '@testing-library/user-event';
import { render, screen } from '@testing-library/react';
import { getInsightsConfig } from 'librechat-data-provider';
import type { TInsightsResponse } from 'librechat-data-provider';
import Charts, { EngagementMetrics } from '../charts';

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string, options?: { name?: string }) =>
    options?.name ? `${key}:${options.name}` : key,
}));

const data: TInsightsResponse = {
  agents: [],
  summary: { totalConversations: 10, totalUsers: 3, totalMessages: 20, totalTokens: 100 },
  daily: [{ date: '2026-10-28', conversations: 10, users: 3, messages: 20, totalTokens: 100 }],
  topUsers: [],
  churnedUsers: [],
  latest: { conversations: [], page: 1, pageSize: 10, pages: 1 },
};
const engagement = {
  activeUsers: 3,
  activeConversations: 4,
  questions: 10,
  singleQuestionConversations: 2,
  activityDistribution: [
    { bucket: '1' as const, users: 2 },
    { bucket: '2–5' as const, users: 1 },
  ],
};

it('does not render retired agent/category charts even for legacy enabled flags', () => {
  const { container } = render(
    <Charts
      data={data}
      config={getInsightsConfig({ charts: { usageByAgent: true, usageByCategory: true } }).charts}
      locale="en"
    />,
  );
  expect(container).toBeEmptyDOMElement();
});

it('shows a compact daily chart, accessible values and a data table', async () => {
  const user = userEvent.setup();
  render(
    <Charts
      data={data}
      config={getInsightsConfig({ charts: { dailyUsage: true } }).charts}
      locale="en"
    />,
  );
  expect(screen.getByRole('img')).toHaveClass('h-44');
  expect(screen.getByLabelText('2026-10-28: 10')).toBeInTheDocument();
  await user.click(screen.getByText('com_insights_view_chart_data'));
  expect(screen.getByRole('table')).toHaveTextContent('2026-10-28');
});

it('uses the full question-asking population for distribution percentages', () => {
  render(<Charts data={{ ...data, engagement }} config={getInsightsConfig().charts} locale="en" />);
  expect(screen.getByLabelText('1: 2 (67%)')).toBeInTheDocument();
  expect(screen.getByLabelText('2–5: 1 (33%)')).toBeInTheDocument();
});

it('calculates question depth from active conversations, not newly-created chats', () => {
  render(<EngagementMetrics data={engagement} locale="en" />);
  expect(screen.getByText('2.5')).toBeInTheDocument();
  expect(screen.getByText('50%')).toBeInTheDocument();
});

it('opens metric information on click or keyboard focus and closes it with Escape', async () => {
  const user = userEvent.setup();
  render(
    <Charts
      data={data}
      config={getInsightsConfig({ charts: { dailyUsage: true } }).charts}
      locale="en"
    />,
  );
  const info = screen.getByRole('button', {
    name: 'com_insights_about_metric:com_insights_daily_usage',
  });
  await user.click(info);
  expect(info).toHaveAttribute('aria-expanded', 'true');
  expect(await screen.findByText('com_insights_usage_definition')).toBeVisible();
  await user.keyboard('{Escape}');
  expect(info).toHaveAttribute('aria-expanded', 'false');
});

it('handles an empty population without invalid ratios', () => {
  render(
    <EngagementMetrics
      data={{ ...engagement, activeConversations: 0, questions: 0, singleQuestionConversations: 0 }}
      locale="en"
    />,
  );
  expect(screen.getByText('0%')).toBeInTheDocument();
  expect(document.body).not.toHaveTextContent('NaN');
});
