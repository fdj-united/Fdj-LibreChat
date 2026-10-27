const mockLogger = {
  debug: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  info: jest.fn(),
};

let activeTenantContext;
const mockTenantStorageRun = jest.fn(async (context, callback) => {
  activeTenantContext = context;
  try {
    return await callback();
  } finally {
    activeTenantContext = undefined;
  }
});
const mockSaveMessage = jest.fn();
const mockSaveConvo = jest.fn();
const mockGetMessages = jest.fn();
const mockFilterPersistableAbortContent = jest.fn((content) =>
  content.filter((part) => part?.type !== 'empty'),
);
const STORE_LOST_ERROR = 'store lost for test';

jest.mock('@librechat/data-schemas', () => ({
  logger: mockLogger,
  tenantStorage: {
    run: (...args) => mockTenantStorageRun(...args),
  },
}));

jest.mock('@librechat/api', () => ({
  GENERATION_STORE_LOST_ERROR: 'store lost for test',
  GenerationJobManager: {},
  filterPersistableAbortContent: (...args) => mockFilterPersistableAbortContent(...args),
  getFailedTurnTraceFields: jest.fn(async () => ({})),
  resolveFailedTurnContent: jest.fn(() => ({})),
  resolvePersistableCodeEnvironmentDecision: jest.fn(() => ({})),
}));

jest.mock('~/server/cleanup', () => ({
  disposeClient: jest.fn(),
}));

jest.mock('~/server/services/MCPRequestContext', () => ({
  getMCPRequestContext: jest.fn(),
  cleanupMCPRequestContextForReq: jest.fn(),
}));

jest.mock('~/server/middleware', () => ({}));

jest.mock('~/cache', () => ({
  logViolation: jest.fn(),
}));

jest.mock('~/models', () => ({
  saveMessage: (...args) => mockSaveMessage(...args),
  saveConvo: (...args) => mockSaveConvo(...args),
  getMessages: (...args) => mockGetMessages(...args),
}));

const { saveStoreLostTurn } = require('../request');

function buildContext(overrides = {}) {
  return {
    streamId: 'convo-1',
    conversationId: 'convo-1',
    endpointOption: { endpoint: 'agents', agent_id: 'agent_abc' },
    isNewConvo: false,
    liveUserMessage: { messageId: 'user-msg-1', conversationId: 'convo-1' },
    liveResponseMessageId: 'response-msg-1',
    contentParts: [{ type: 'text', text: 'partial answer' }],
    sender: 'Agent',
    ...overrides,
  };
}

describe('saveStoreLostTurn', () => {
  const req = { user: { id: 'user-1' }, body: {} };

  beforeEach(() => {
    jest.clearAllMocks();
    activeTenantContext = undefined;
    mockSaveMessage.mockResolvedValue({ persisted: true });
    mockSaveConvo.mockResolvedValue({});
    mockGetMessages.mockResolvedValue([]);
  });

  it('saves the partial response as unfinished, keyed by the live response messageId', async () => {
    await expect(saveStoreLostTurn(req, buildContext())).resolves.toBe(true);

    expect(mockSaveMessage).toHaveBeenCalledTimes(1);
    expect(mockSaveMessage).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-1' }),
      expect.objectContaining({
        messageId: 'response-msg-1',
        parentMessageId: 'user-msg-1',
        conversationId: 'convo-1',
        content: [{ type: 'text', text: 'partial answer' }],
        unfinished: true,
        error: false,
        isCreatedByUser: false,
        user: 'user-1',
        sender: 'Agent',
        agent_id: 'agent_abc',
      }),
      expect.objectContaining({ context: expect.stringContaining('store loss') }),
    );
  });

  it('is idempotent: a repeated call upserts the same messageId', async () => {
    await saveStoreLostTurn(req, buildContext());
    await saveStoreLostTurn(req, buildContext());

    expect(mockSaveMessage).toHaveBeenCalledTimes(2);
    const [first, second] = mockSaveMessage.mock.calls.map(([, message]) => message);
    expect(first.messageId).toBe('response-msg-1');
    expect(second.messageId).toBe(first.messageId);
    expect(second).toEqual(first);
  });

  it('falls back to the preliminary response id when the live one is unknown', async () => {
    await saveStoreLostTurn(req, buildContext({ liveResponseMessageId: undefined }));

    expect(mockSaveMessage).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ messageId: 'user-msg-1_', parentMessageId: 'user-msg-1' }),
      expect.anything(),
    );
  });

  it('runs the save inside the tenant context', async () => {
    let tenantDuringSave;
    mockSaveMessage.mockImplementation(async () => {
      tenantDuringSave = activeTenantContext;
      return { persisted: true };
    });

    await saveStoreLostTurn(req, buildContext({ tenantId: 'tenant-a' }));

    expect(tenantDuringSave).toEqual({ tenantId: 'tenant-a', userId: 'user-1' });
  });

  it('writes the store-lost error turn when nothing is persistable', async () => {
    /** No partial row was written, so the caller must not claim one was saved. */
    await expect(
      saveStoreLostTurn(
        req,
        buildContext({
          contentParts: [{ type: 'empty' }],
          liveResponseMessageId: 'response-msg-1',
        }),
      ),
    ).resolves.toBe(false);

    /** The failed-turn writer upserts the user row, then the error row. */
    expect(mockSaveMessage).toHaveBeenCalledTimes(2);
    expect(mockSaveMessage).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({
        messageId: 'user-msg-1_',
        parentMessageId: 'user-msg-1',
        text: STORE_LOST_ERROR,
        error: true,
      }),
      expect.anything(),
    );
  });

  it('rethrows when the partial response could not be persisted', async () => {
    mockSaveMessage.mockResolvedValue(null);

    await expect(saveStoreLostTurn(req, buildContext())).rejects.toThrow(
      'Partial response could not be persisted after store loss',
    );
  });
});
