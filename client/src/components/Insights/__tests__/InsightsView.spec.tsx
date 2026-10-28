import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import userEvent from '@testing-library/user-event';
import { getInsightsConfig } from 'librechat-data-provider';
import { render, screen, waitFor } from '@testing-library/react';
import type { TInsightsParams, TInsightsResponse } from 'librechat-data-provider';
import type { TInsightsConfig } from 'librechat-data-provider';
import InsightsView from '../InsightsView';

const insightsData: TInsightsResponse = {
  agents: [
    { id: 'agent-1', name: 'Alpha' },
    { id: 'agent-2', name: 'Beta' },
    { id: 'agent-3', name: 'Gamma' },
  ],
  summary: { totalConversations: 4, totalUsers: 2, totalMessages: 8, totalTokens: 100 },
  daily: [],
  latest: { conversations: [], page: 1, pageSize: 10, pages: 1 },
  topUsers: [],
  churnedUsers: [],
};

const mockUseInsightsQuery = jest.fn((params: TInsightsParams) => ({
  data: insightsData,
  isLoading: false,
  isFetching: false,
  error: null,
  params,
}));

const mockStartupConfig: { insightsEnabled: boolean; insights?: TInsightsConfig } = {
  insightsEnabled: true,
};

jest.mock('~/data-provider', () => ({
  useGetStartupConfig: () => ({ data: mockStartupConfig, isLoading: false }),
  useInsightsQuery: (params: TInsightsParams) => mockUseInsightsQuery(params),
}));

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string, options?: { count?: number; name?: string }) => {
    if (options?.count != null) {
      return `${key}:${options.count}`;
    }
    return options?.name ? `${key}:${options.name}` : key;
  },
  useAuthContext: () => ({ user: { id: 'user-1' } }),
  useDocumentTitle: () => undefined,
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ i18n: { language: 'en', resolvedLanguage: 'en' } }),
}));

jest.mock('~/components/Chat/Menus/OpenSidebar', () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock('~/components/ui', () => ({
  LocalizedDateRangePicker: () => null,
}));

function lastQueryParams(): TInsightsParams {
  return mockUseInsightsQuery.mock.calls[mockUseInsightsQuery.mock.calls.length - 1][0];
}

function renderView() {
  return render(
    <MemoryRouter initialEntries={['/insights']}>
      <InsightsView />
    </MemoryRouter>,
  );
}

async function openAgentMenu(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByText('com_insights_all_agents:3'));
  await screen.findByRole('option', { name: 'Alpha' });
}

describe('InsightsView agent selection', () => {
  beforeEach(() => {
    delete mockStartupConfig.insights;
    mockUseInsightsQuery.mockClear();
    mockUseInsightsQuery.mockImplementation((params) => ({
      data: insightsData,
      isLoading: false,
      isFetching: false,
      error: null,
      params,
    }));
  });

  it('hides first-message content even if a stale response still includes it', () => {
    mockStartupConfig.insights = getInsightsConfig({ privacy: { includeFirstMessage: false } });
    mockUseInsightsQuery.mockImplementation((params) => ({
      data: {
        ...insightsData,
        latest: {
          conversations: [
            {
              conversationId: 'chat',
              agentId: 'agent-1',
              agentName: 'Alpha',
              userId: 'u',
              name: 'User',
              email: 'user@example.com',
              date: '2026-10-28T10:00:00Z',
              firstMessage: 'private preview',
              messages: 1,
              totalTokens: 10,
            },
          ],
          page: 1,
          pageSize: 10,
          pages: 1,
        },
      },
      isLoading: false,
      isFetching: false,
      error: null,
      params,
    }));
    renderView();
    expect(screen.queryByText('com_insights_first_message')).not.toBeInTheDocument();
    expect(screen.queryByText('private preview')).not.toBeInTheDocument();
    expect(screen.getByRole('table', { name: '' })).toBeInTheDocument();
  });

  it('sends selected categories through the existing query interface', async () => {
    mockStartupConfig.insights = getInsightsConfig({ filters: { categories: true } });
    mockUseInsightsQuery.mockImplementation((params) => ({
      data: { ...insightsData, categories: ['HR', 'Tech'] },
      isLoading: false,
      isFetching: false,
      error: null,
      params,
    }));
    const user = userEvent.setup();
    renderView();
    await user.click(screen.getByText('com_insights_all_categories'));
    await user.click(await screen.findByRole('option', { name: 'HR' }));
    await waitFor(() => expect(lastQueryParams().categories).toEqual(['HR']));
  });

  it('filters names without changing selection and clears search on close', async () => {
    mockUseInsightsQuery.mockImplementation((params) => ({
      data: {
        ...insightsData,
        agents: Array.from({ length: 12 }, (_, i) => ({ id: `agent-${i}`, name: `Agent ${i}` })),
      },
      isLoading: false,
      isFetching: false,
      error: null,
      params,
    }));
    const user = userEvent.setup();
    renderView();
    await user.click(screen.getByText('com_insights_all_agents:12'));
    const search = screen.getByRole('textbox', { name: 'com_insights_search_agents' });
    await user.type(search, 'AGENT 11');
    expect(screen.getAllByRole('option')).toHaveLength(1);
    expect(lastQueryParams().agentIds).toBeUndefined();
    await user.click(screen.getByRole('button', { name: 'com_ui_clear_all' }));
    await user.click(screen.getByRole('button', { name: 'com_insights_select_all_agents' }));
    expect(screen.getByText('com_insights_all_agents:12')).toBeInTheDocument();
    await user.clear(search);
    await user.type(search, 'no match');
    expect(screen.getByRole('status')).toHaveTextContent('com_insights_no_agents_found');
    await user.keyboard('{Escape}');
    await user.click(screen.getByText('com_insights_all_agents:12'));
    expect(screen.getByRole('textbox', { name: 'com_insights_search_agents' })).toHaveValue('');
    expect(screen.getAllByRole('option')).toHaveLength(12);
  });

  it('clears every agent without committing the empty selection', async () => {
    const user = userEvent.setup();
    renderView();
    await openAgentMenu(user);

    await user.click(screen.getByRole('button', { name: 'com_ui_clear_all' }));

    expect(screen.getByText('com_insights_no_agents_selected')).toBeInTheDocument();
    for (const option of screen.getAllByRole('option')) {
      expect(option).toHaveAttribute('aria-selected', 'false');
    }
    expect(lastQueryParams().agentIds).toBeUndefined();
  });

  it('commits only the agents picked after clearing', async () => {
    const user = userEvent.setup();
    renderView();
    await openAgentMenu(user);

    await user.click(screen.getByRole('button', { name: 'com_ui_clear_all' }));
    await user.click(screen.getByRole('option', { name: 'Beta' }));

    await waitFor(() => expect(lastQueryParams().agentIds).toEqual(['agent-2']));
  });

  it('restores the committed selection when the menu closes while empty', async () => {
    const user = userEvent.setup();
    renderView();
    await openAgentMenu(user);

    await user.click(screen.getByRole('button', { name: 'com_ui_clear_all' }));
    await user.keyboard('{Escape}');

    await waitFor(() => expect(screen.getByText('com_insights_all_agents:3')).toBeInTheDocument());
    expect(lastQueryParams().agentIds).toBeUndefined();
  });

  it('re-enables select all from the cleared state', async () => {
    const user = userEvent.setup();
    renderView();
    await openAgentMenu(user);

    await user.click(screen.getByRole('button', { name: 'com_ui_clear_all' }));
    const selectAll = screen.getByRole('button', { name: 'com_insights_select_all_agents' });

    await user.click(selectAll);
    expect(screen.getByText('com_insights_all_agents:3')).toBeInTheDocument();
    expect(lastQueryParams().agentIds).toBeUndefined();
  });
});
