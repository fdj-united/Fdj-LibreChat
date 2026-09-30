import React from 'react';
import '@testing-library/jest-dom';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { TNotification } from 'librechat-data-provider';

const mockUseNotificationsQuery = jest.fn();
const mockUseUnreadNotificationCount = jest.fn();
const mockMarkReadMutate = jest.fn();
const mockMarkAllReadMutate = jest.fn();

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string, opts?: Record<string, string | number>) =>
    opts ? `${key}|${JSON.stringify(opts)}` : key,
}));

jest.mock('~/data-provider', () => ({
  useNotificationsQuery: (...args: unknown[]) => mockUseNotificationsQuery(...args),
  useUnreadNotificationCount: (...args: unknown[]) => mockUseUnreadNotificationCount(...args),
  useMarkNotificationReadMutation: () => ({
    mutate: mockMarkReadMutate,
    isLoading: false,
    variables: undefined,
  }),
  useMarkAllNotificationsReadMutation: () => ({
    mutate: mockMarkAllReadMutate,
    isLoading: false,
  }),
}));

jest.mock('@librechat/client', () => ({
  Accordion: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AccordionContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AccordionItem: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AccordionTrigger: ({ children }: { children: React.ReactNode }) => <button>{children}</button>,
  TooltipAnchor: ({ render }: { render: React.ReactElement }) => render,
}));

import HeaderBell from '../HeaderBell';

const unreadNotification: TNotification = {
  id: 'n-unread',
  type: 'announcement',
  title: 'Unread title',
  message: 'Unread message',
  user: 'user-1',
  read: false,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const readNotification: TNotification = {
  id: 'n-read',
  type: 'generic',
  title: 'Read title',
  message: 'Read message',
  user: 'user-1',
  read: true,
  createdAt: new Date(Date.now() - 60_000).toISOString(),
  updatedAt: new Date(Date.now() - 60_000).toISOString(),
};

function renderBell() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <HeaderBell />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function getBellButton() {
  return screen.getByRole('button', { name: /com_ui_notifications_unread_count/ });
}

describe('HeaderBell', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseUnreadNotificationCount.mockReturnValue(1);
    mockUseNotificationsQuery.mockImplementation((params: { unreadOnly?: boolean }) => {
      if (params?.unreadOnly === true) {
        return {
          data: { notifications: [unreadNotification], nextCursor: null, hasNextPage: false },
          isLoading: false,
        };
      }
      return {
        data: {
          notifications: [unreadNotification, readNotification],
          nextCursor: null,
          hasNextPage: false,
        },
        isLoading: false,
      };
    });
  });

  it('exposes trigger accessibility attributes', () => {
    renderBell();

    const trigger = getBellButton();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(trigger).toHaveAttribute('aria-haspopup', 'dialog');
    expect(trigger).toHaveAttribute('aria-controls', 'notification-panel');
  });

  it('fetches unread notifications separately when opened', () => {
    renderBell();

    fireEvent.click(getBellButton());

    expect(mockUseNotificationsQuery).toHaveBeenCalledWith(
      { unreadOnly: true, limit: 100 },
      expect.objectContaining({ enabled: true }),
    );
    expect(mockUseNotificationsQuery).toHaveBeenCalledWith(
      { limit: 50 },
      expect.objectContaining({ enabled: true }),
    );
    expect(screen.getByText('Unread title')).toBeInTheDocument();
    expect(screen.getByText('Read title')).toBeInTheDocument();
  });

  it('labels the panel and exposes a live region', () => {
    renderBell();

    fireEvent.click(getBellButton());

    expect(screen.getByText('com_ui_notifications')).toBeInTheDocument();
    expect(document.getElementById('notification-panel')).toHaveAttribute(
      'aria-labelledby',
      'notification-panel-title',
    );
    expect(document.querySelector('[aria-live="polite"]')).toBeInTheDocument();
  });

  it('closes on Escape', async () => {
    renderBell();

    const trigger = getBellButton();
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');

    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape', code: 'Escape' });

    await waitFor(() => {
      expect(trigger).toHaveAttribute('aria-expanded', 'false');
    });
  });

  it('opens notification links in a new tab', () => {
    const openSpy = jest.spyOn(window, 'open').mockImplementation(() => null);
    const verificationNotification: TNotification = {
      ...unreadNotification,
      id: 'n-verification',
      type: 'agent_verification',
      title: 'New comment on Test Agent',
      message: 'Reviewer: Looks good',
      link: '/c/new?agent_id=agent_abc&panel=review-agent',
    };

    mockUseNotificationsQuery.mockImplementation((params: { unreadOnly?: boolean }) => {
      if (params?.unreadOnly === true) {
        return {
          data: { notifications: [verificationNotification], nextCursor: null, hasNextPage: false },
          isLoading: false,
        };
      }
      return {
        data: { notifications: [verificationNotification], nextCursor: null, hasNextPage: false },
        isLoading: false,
      };
    });

    renderBell();
    fireEvent.click(getBellButton());
    fireEvent.click(screen.getByRole('button', { name: 'New comment on Test Agent' }));

    expect(openSpy).toHaveBeenCalledWith(
      `${window.location.origin}/c/new?agent_id=agent_abc&panel=review-agent`,
      '_blank',
      'noopener,noreferrer',
    );
    openSpy.mockRestore();
  });

  it('exposes the full title as a tooltip on truncated notification titles', () => {
    const longTitle = 'A very long notification title that should be truncated in the card layout';
    const longTitleNotification: TNotification = {
      ...unreadNotification,
      title: longTitle,
    };

    mockUseNotificationsQuery.mockImplementation((params: { unreadOnly?: boolean }) => {
      if (params?.unreadOnly === true) {
        return {
          data: { notifications: [longTitleNotification], nextCursor: null, hasNextPage: false },
          isLoading: false,
        };
      }
      return {
        data: { notifications: [longTitleNotification], nextCursor: null, hasNextPage: false },
        isLoading: false,
      };
    });

    renderBell();
    fireEvent.click(getBellButton());

    expect(screen.getByText(longTitle)).toHaveAttribute('title', longTitle);
  });
});
