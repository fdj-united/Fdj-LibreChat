import { renderHook, act } from '@testing-library/react';
import { request } from 'librechat-data-provider';
import type { TMessage, TSubmission } from 'librechat-data-provider';

type SSEEventListener = (e: Partial<MessageEvent> & { responseCode?: number }) => void;

interface MockSSEInstance {
  addEventListener: jest.Mock;
  stream: jest.Mock;
  close: jest.Mock;
  dispatchEvent: jest.Mock;
  headers: Record<string, string>;
  readyState: number;
  _listeners: Record<string, SSEEventListener>;
  _emit: (event: string, data?: Partial<MessageEvent> & { responseCode?: number }) => void;
}

const mockSSEInstances: MockSSEInstance[] = [];

jest.mock('sse.js', () => ({
  SSE: jest
    .fn()
    .mockImplementation((_url: string, options?: { headers?: Record<string, string> }) => {
      const listeners: Record<string, SSEEventListener> = {};
      const instance: MockSSEInstance = {
        addEventListener: jest.fn((event: string, cb: SSEEventListener) => {
          listeners[event] = cb;
        }),
        stream: jest.fn(),
        close: jest.fn(),
        dispatchEvent: jest.fn(),
        headers: { ...(options?.headers ?? {}) },
        readyState: 2,
        _listeners: listeners,
        _emit: (event, data = {}) => listeners[event]?.(data as MessageEvent),
      };
      mockSSEInstances.push(instance);
      return instance;
    }),
}));

const mockActiveRunAtom = { key: 'activeRun' };
const mockAbortScrollAtom = { key: 'abortScroll' };
const mockShowStopButtonAtom = { key: 'showStopButton' };
const mockSetActiveRun = jest.fn();
const mockSetAbortScroll = jest.fn();
const mockSetShowStopButton = jest.fn();
const mockSetPendingMCPConfirmations = jest.fn();
const mockUseSetRecoilStateMock = jest.fn((atom: unknown) => {
  if (atom === mockActiveRunAtom) {
    return mockSetActiveRun;
  }
  if (atom === mockAbortScrollAtom) {
    return mockSetAbortScroll;
  }
  if (atom === mockShowStopButtonAtom) {
    return mockSetShowStopButton;
  }
  if (
    typeof atom === 'object' &&
    atom != null &&
    'key' in atom &&
    (atom as { key?: string }).key === 'pendingMCPConfirmations'
  ) {
    return mockSetPendingMCPConfirmations;
  }
  return jest.fn();
});

jest.mock('recoil', () => ({
  ...jest.requireActual('recoil'),
  useSetRecoilState: (atom: unknown) => mockUseSetRecoilStateMock(atom),
}));

jest.mock('~/store', () => {
  const pendingMCPConfirmationsAtom = { key: 'pendingMCPConfirmations' };
  return {
    __esModule: true,
    default: {
      activeRunFamily: jest.fn(() => mockActiveRunAtom),
      abortScrollFamily: jest.fn(() => mockAbortScrollAtom),
      showStopButtonByIndex: jest.fn(() => mockShowStopButtonAtom),
    },
    pendingMCPConfirmationsAtom,
  };
});

jest.mock('~/hooks/AuthContext', () => ({
  useAuthContext: () => ({ token: 'test-token', isAuthenticated: true }),
}));

jest.mock('~/data-provider', () => ({
  useGetStartupConfig: () => ({ data: { balance: { enabled: false } } }),
  useGetUserBalance: () => ({ refetch: jest.fn() }),
}));

const mockErrorHandler = jest.fn();
const mockFinalHandler = jest.fn();
const mockCreatedHandler = jest.fn();
const mockSetIsSubmitting = jest.fn();
const mockClearStepMaps = jest.fn();
const mockAbortConversation = jest.fn();

jest.mock('~/hooks/SSE/useEventHandlers', () => ({
  __esModule: true,
  default: jest.fn(() => ({
    errorHandler: mockErrorHandler,
    finalHandler: mockFinalHandler,
    createdHandler: mockCreatedHandler,
    attachmentHandler: jest.fn(),
    stepHandler: jest.fn(),
    titleHandler: jest.fn(),
    contentHandler: jest.fn(),
    messageHandler: jest.fn(),
    syncHandler: jest.fn(),
    clearStepMaps: mockClearStepMaps,
    abortConversation: mockAbortConversation,
    setIsSubmitting: mockSetIsSubmitting,
    setShowStopButton: jest.fn(),
  })),
}));

jest.mock('~/hooks/SSE/useUsageHandler', () => ({
  __esModule: true,
  default: () => ({
    contextHandler: jest.fn(),
    usageHandler: jest.fn(),
    tapStream: jest.fn(),
    tapContent: jest.fn(),
    finalizeUsage: jest.fn(),
    resetLive: jest.fn(),
    attributePending: jest.fn(),
  }),
}));

jest.mock('~/utils', () => ({
  clearAllDrafts: jest.fn(),
}));

jest.mock('librechat-data-provider', () => {
  const actual = jest.requireActual('librechat-data-provider');
  return {
    ...actual,
    createPayload: jest.fn(() => ({
      payload: { model: 'gpt-4o' },
      server: '/api/agents/chat',
    })),
    removeNullishValues: jest.fn((v: unknown) => v),
    request: {
      recoverAuth: jest.fn(),
      refreshToken: jest.fn(),
      dispatchTokenUpdatedEvent: jest.fn(),
    },
  };
});

import useSSE from '~/hooks/SSE/useSSE';

const CONV_ID = 'conv-sse-401';

const buildSubmission = (): TSubmission =>
  ({
    conversation: { conversationId: CONV_ID },
    userMessage: {
      messageId: 'msg-1',
      conversationId: CONV_ID,
      text: 'Hello',
      isCreatedByUser: true,
      sender: 'User',
      parentMessageId: '00000000-0000-0000-0000-000000000000',
    },
    messages: [],
    isTemporary: false,
    initialResponse: {
      messageId: 'resp-1',
      conversationId: CONV_ID,
      text: '',
      isCreatedByUser: false,
      sender: 'Assistant',
    },
    endpointOption: { endpoint: 'agents' },
  }) as unknown as TSubmission;

const buildChatHelpers = () => ({
  setMessages: jest.fn(),
  getMessages: jest.fn<TMessage[], []>(() => []),
  setConversation: jest.fn(),
  setIsSubmitting: mockSetIsSubmitting,
  newConversation: jest.fn(),
});

const getLastSSE = (): MockSSEInstance => {
  const sse = mockSSEInstances[mockSSEInstances.length - 1];
  expect(sse).toBeDefined();
  return sse;
};

describe('useSSE - 401 auth recovery', () => {
  beforeEach(() => {
    mockSSEInstances.length = 0;
    mockErrorHandler.mockClear();
    mockFinalHandler.mockClear();
    mockSetIsSubmitting.mockClear();
    mockSetShowStopButton.mockClear();
    mockClearStepMaps.mockClear();
    (request.recoverAuth as jest.Mock).mockReset();
  });

  const renderAndEmit401 = async (errorData?: string) => {
    const submission = buildSubmission();
    const chatHelpers = buildChatHelpers();
    const { unmount } = renderHook(() => useSSE(submission, chatHelpers));

    await act(async () => {
      await Promise.resolve();
    });

    const sse = getLastSSE();
    const streamCallsBefore401 = (sse.stream as jest.Mock).mock.calls.length;

    await act(async () => {
      sse._emit('error', {
        responseCode: 401,
        ...(errorData != null ? { data: errorData } : {}),
      });
      await Promise.resolve();
    });

    return { sse, unmount, streamCallsBefore401 };
  };

  it('calls recoverAuth once, installs Authorization, and retries the stream on 401', async () => {
    const freshToken = 'fresh-legacy-sse-token';
    (request.recoverAuth as jest.Mock).mockResolvedValue({
      token: freshToken,
      redirected: false,
    });

    const { sse, unmount, streamCallsBefore401 } = await renderAndEmit401();

    expect(request.recoverAuth).toHaveBeenCalledTimes(1);
    expect(sse.headers).toEqual({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${freshToken}`,
    });
    expect(sse.stream).toHaveBeenCalledTimes(streamCallsBefore401 + 1);
    expect(mockErrorHandler).not.toHaveBeenCalled();
    unmount();
  });

  it('does not retry the stream when recoverAuth returns no token', async () => {
    (request.recoverAuth as jest.Mock).mockResolvedValue({
      token: null,
      redirected: true,
    });

    const { sse, unmount, streamCallsBefore401 } = await renderAndEmit401(
      JSON.stringify({ text: 'unauthorized' }),
    );

    expect(request.recoverAuth).toHaveBeenCalledTimes(1);
    expect(sse.stream).toHaveBeenCalledTimes(streamCallsBefore401);
    expect(sse.headers.Authorization).toBe('Bearer test-token');
    expect(mockErrorHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ text: 'unauthorized' }),
        submission: expect.objectContaining({
          conversation: expect.objectContaining({ conversationId: CONV_ID }),
        }),
      }),
    );
    unmount();
  });

  it('does not retry the stream when recoverAuth fails without a redirect', async () => {
    (request.recoverAuth as jest.Mock).mockResolvedValue({
      token: null,
      redirected: false,
    });

    const { sse, unmount, streamCallsBefore401 } = await renderAndEmit401(
      JSON.stringify({ text: 'session expired' }),
    );

    expect(request.recoverAuth).toHaveBeenCalledTimes(1);
    expect(sse.stream).toHaveBeenCalledTimes(streamCallsBefore401);
    expect(sse.headers.Authorization).toBe('Bearer test-token');
    expect(mockErrorHandler).toHaveBeenCalled();
    unmount();
  });
});
