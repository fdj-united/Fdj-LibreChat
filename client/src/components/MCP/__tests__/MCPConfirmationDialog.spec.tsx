/**
 * Unit tests for the MCP confirmation queue UI behavior in the dialog.
 *
 * Covers spec §5.1:
 *   - empty queue hides the dialog
 *   - dialog renders the head only
 *   - "1 of N pending" badge appears only when queue length > 1
 *   - clicking Accept pops the head; next entry becomes visible
 *   - clicking Cancel pops the head
 *   - per-entry deadline drives the countdown for the head
 */

import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { RecoilRoot, useSetRecoilState } from 'recoil';
import MCPConfirmationDialog from '../MCPConfirmationDialog';
import {
  pendingMCPConfirmationsAtom,
  type MCPPendingConfirmation,
} from '~/store/mcpConfirmation';

// Mock the auth context — the dialog's only use of `token` is to attach as a
// Bearer header on `postDecision`'s fetch, which we mock at the global level.
jest.mock('~/hooks/AuthContext', () => ({
  useAuthContext: () => ({ token: 'test-token' }),
}));

// Mock the OGDialog portal-based Radix components so jsdom doesn't have to
// deal with portals. We render children straight into the testing container
// when `open` is true; when closed/null, we render nothing.
jest.mock('@librechat/client', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react');
  return {
    OGDialog: ({ children, open }: any) =>
      open ? <div data-testid="dialog-root">{children}</div> : null,
    OGDialogContent: ({ children }: any) => (
      <div data-testid="dialog-content">{children}</div>
    ),
    OGDialogHeader: ({ children }: any) => <div>{children}</div>,
    OGDialogFooter: ({ children }: any) => <div>{children}</div>,
    OGDialogTitle: ({ children }: any) => <h2>{children}</h2>,
    Button: ({ children, onClick, disabled }: any) => (
      <button type="button" onClick={onClick} disabled={disabled}>
        {children}
      </button>
    ),
  };
});

// Stable global fetch mock — we never want a test to hit the real network.
beforeEach(() => {
  (global as any).fetch = jest.fn(() =>
    Promise.resolve({ ok: true, status: 204 } as Response),
  );
});

afterEach(() => {
  jest.restoreAllMocks();
});

function makePending(
  overrides: Partial<MCPPendingConfirmation> = {},
): MCPPendingConfirmation {
  return {
    confirmationId: 'cid-A',
    serverName: 'test-server',
    toolName: 'test-tool',
    preview: 'Tool: test-tool\n  arg: "value"',
    expiresInSeconds: 120,
    expiresAt: Date.now() + 120_000,
    deadline: Date.now() + 120_000,
    ...overrides,
  };
}

/**
 * Helper component that exposes a setter for the atom so tests can drive
 * enqueue / dedup / pop without touching internals.
 */
function QueueDriver({ initial }: { initial: MCPPendingConfirmation[] }) {
  const setQueue = useSetRecoilState(pendingMCPConfirmationsAtom);
  React.useEffect(() => {
    setQueue(initial);
    // initial is stable per render in tests; we want this once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

function renderWithQueue(initial: MCPPendingConfirmation[]) {
  return render(
    <RecoilRoot>
      <QueueDriver initial={initial} />
      <MCPConfirmationDialog />
    </RecoilRoot>,
  );
}

describe('MCPConfirmationDialog queue mechanics', () => {
  test('empty queue hides the dialog', () => {
    renderWithQueue([]);
    expect(screen.queryByTestId('dialog-root')).toBeNull();
    expect(screen.queryByText(/Confirm action/)).toBeNull();
  });

  test('renders the head only when queue has one entry', () => {
    renderWithQueue([
      makePending({ confirmationId: 'cid-A', toolName: 'tool-A' }),
    ]);
    expect(screen.getByText(/Confirm action: tool-A/)).toBeInTheDocument();
    // No "N pending" badge when queue length is 1.
    expect(screen.queryByText(/of \d+ pending/)).toBeNull();
  });

  test('renders only the head when queue has multiple entries; shows N-pending badge', () => {
    renderWithQueue([
      makePending({ confirmationId: 'cid-A', toolName: 'tool-A' }),
      makePending({ confirmationId: 'cid-B', toolName: 'tool-B' }),
      makePending({ confirmationId: 'cid-C', toolName: 'tool-C' }),
    ]);
    expect(screen.getByText(/Confirm action: tool-A/)).toBeInTheDocument();
    expect(screen.queryByText(/Confirm action: tool-B/)).toBeNull();
    expect(screen.queryByText(/Confirm action: tool-C/)).toBeNull();
    expect(screen.getByText(/1 of 3 pending/)).toBeInTheDocument();
  });

  test('clicking Accept pops the head; next entry becomes visible', async () => {
    renderWithQueue([
      makePending({ confirmationId: 'cid-A', toolName: 'tool-A' }),
      makePending({ confirmationId: 'cid-B', toolName: 'tool-B' }),
    ]);
    expect(screen.getByText(/Confirm action: tool-A/)).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByText('Accept'));
    });

    // After pop, head is now tool-B.
    expect(screen.queryByText(/Confirm action: tool-A/)).toBeNull();
    expect(screen.getByText(/Confirm action: tool-B/)).toBeInTheDocument();
    // Badge hides because length is now 1.
    expect(screen.queryByText(/of \d+ pending/)).toBeNull();
  });

  test('clicking Cancel pops the head', async () => {
    renderWithQueue([
      makePending({ confirmationId: 'cid-A', toolName: 'tool-A' }),
      makePending({ confirmationId: 'cid-B', toolName: 'tool-B' }),
    ]);
    await act(async () => {
      fireEvent.click(screen.getByText('Cancel'));
    });
    expect(screen.queryByText(/Confirm action: tool-A/)).toBeNull();
    expect(screen.getByText(/Confirm action: tool-B/)).toBeInTheDocument();
  });

  test('per-entry deadline drives the countdown for the current head', () => {
    // Entry 1 (head): deadline ~60s out. Entry 2: deadline ~30s out.
    // The dialog should display ~60s — proving it reads the HEAD's deadline,
    // not some other entry's, and not a fresh full TTL of 120s.
    const now = Date.now();
    renderWithQueue([
      makePending({
        confirmationId: 'cid-A',
        toolName: 'tool-A',
        deadline: now + 60_000,
      }),
      makePending({
        confirmationId: 'cid-B',
        toolName: 'tool-B',
        deadline: now + 30_000,
      }),
    ]);
    const text = screen.getByText(/Auto-cancels in/).textContent ?? '';
    const seconds = parseInt(text.match(/(\d+)s/)?.[1] ?? '-1', 10);
    expect(seconds).toBeGreaterThanOrEqual(58);
    expect(seconds).toBeLessThanOrEqual(60);
  });
});
