import React from 'react';
import userEvent from '@testing-library/user-event';
import { render, screen, within } from '@testing-library/react';
import { getInsightsConfig, INSIGHTS_UNCATEGORIZED } from 'librechat-data-provider';
import type { TInsightsResponse } from 'librechat-data-provider';
import Charts from '../charts';

jest.mock('~/hooks', () => ({ useLocalize: () => (key: string) => key }));

beforeAll(() => {
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.setPointerCapture = () => undefined;
  Element.prototype.releasePointerCapture = () => undefined;
  Element.prototype.scrollIntoView = () => undefined;
});

const data: TInsightsResponse = {
  agents: [],
  summary: { totalConversations: 10, totalUsers: 2, totalMessages: 20, totalTokens: 100 },
  daily: [{ date: '2026-10-28', conversations: 10, users: 2, messages: 20, totalTokens: 100 }],
  topUsers: [],
  churnedUsers: [],
  latest: { conversations: [], page: 1, pageSize: 10, pages: 1 },
  breakdowns: {
    agents: [
      { id: 'a', label: 'Alpha', conversations: 6 },
      { id: 'b', label: 'Beta', conversations: 3 },
      { id: 'c', label: 'Gamma', conversations: 1 },
    ],
    categories: [{ id: INSIGHTS_UNCATEGORIZED, label: INSIGHTS_UNCATEGORIZED, conversations: 10 }],
  },
};

it('keeps charts disabled by default', () => {
  const { container } = render(
    <Charts data={data} config={getInsightsConfig().charts} locale="en" />,
  );
  expect(container).toBeEmptyDOMElement();
});

it('preserves the full denominator when grouping the remainder and switches chart view', async () => {
  const user = userEvent.setup();
  render(
    <Charts
      data={data}
      config={getInsightsConfig({ charts: { usageByAgent: true, topN: 2 } }).charts}
      locale="en"
    />,
  );
  const legend = screen.getByRole('list', { name: 'com_insights_usage_by_agent' });
  expect(within(legend).getByText('6 (60%)')).toBeInTheDocument();
  expect(within(legend).getByText('3 (30%)')).toBeInTheDocument();
  expect(within(legend).getByText('1 (10%)')).toBeInTheDocument();
  expect(within(legend).getByText('com_insights_other_combined')).toBeInTheDocument();
  expect(within(legend).queryByText('Gamma')).not.toBeInTheDocument();
  expect(screen.getByRole('img', { name: 'com_insights_usage_by_agent' })).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'com_insights_graph' }));
  expect(
    screen.queryByRole('img', { name: 'com_insights_usage_by_agent' }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'com_insights_graph' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
});

it('supports one-day graphs, accessible values, and uncategorised conversations', async () => {
  const user = userEvent.setup();
  render(
    <Charts
      data={data}
      config={getInsightsConfig({ charts: { dailyUsage: true, usageByCategory: true } }).charts}
      locale="en"
    />,
  );
  expect(screen.getByText('com_insights_uncategorized')).toBeInTheDocument();
  expect(screen.getByLabelText('2026-10-28: 10')).toBeInTheDocument();
  await user.click(screen.getByText('com_insights_view_chart_data'));
  expect(screen.getByRole('table')).toHaveTextContent('2026-10-28');
  await user.click(screen.getByRole('combobox', { name: 'com_insights_metric' }));
  await user.click(screen.getByRole('option', { name: 'com_insights_messages' }));
  expect(screen.getByRole('table')).toHaveTextContent('20');
});

it('handles an empty breakdown without invalid percentages', () => {
  render(
    <Charts
      data={{ ...data, breakdowns: { agents: [] } }}
      config={getInsightsConfig({ charts: { usageByAgent: true } }).charts}
      locale="en"
    />,
  );
  expect(screen.getByText('com_insights_no_data')).toBeInTheDocument();
  expect(screen.queryByRole('img')).not.toBeInTheDocument();
  expect(document.body).not.toHaveTextContent('NaN');
});
