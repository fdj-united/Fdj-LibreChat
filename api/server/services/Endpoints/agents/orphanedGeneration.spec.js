jest.mock('@librechat/data-schemas', () => ({
  ...jest.requireActual('@librechat/data-schemas'),
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

const { getTenantId } = require('@librechat/data-schemas');
const { createOrphanedGenerationHandler } = require('./orphanedGeneration');

const conversationId = '0b8f3c62-6a36-4f2b-9d55-6f7d3f6b3a10';
/** The user message is already in Mongo unless a test says otherwise. */
const getMessages = jest.fn(async () => [{ messageId: 'user-msg-1' }]);

function buildResult(overrides = {}) {
  return {
    success: true,
    text: 'Hello dead owner',
    content: [{ type: 'text', text: 'Hello dead owner' }],
    collectedUsage: [],
    finalEvent: null,
    jobData: {
      streamId: conversationId,
      userId: 'user-1',
      tenantId: 'tenant-a',
      status: 'aborted',
      createdAt: 1000,
      conversationId,
      responseMessageId: 'response-1',
      userMessage: { messageId: 'user-msg-1', parentMessageId: 'root', text: 'hi' },
      sender: 'Agent',
      endpoint: 'agents',
      model: 'claude',
      agent_id: 'agent_abc',
      isTemporary: true,
      retentionExpiresAt: '2026-11-27T00:00:00.000Z',
      ...overrides.jobData,
    },
    ...overrides.result,
  };
}

describe('createOrphanedGenerationHandler', () => {
  it('saves the partial as an unfinished response under the job tenant and user', async () => {
    const seenTenants = [];
    const saveMessage = jest.fn(async () => {
      seenTenants.push(getTenantId());
      return { messageId: 'response-1' };
    });
    const getInterfaceConfig = jest.fn(async () => ({ retentionMode: 'all' }));
    const handler = createOrphanedGenerationHandler({
      saveMessage,
      getMessages,
      getInterfaceConfig,
    });

    await handler(conversationId, buildResult());

    expect(getInterfaceConfig).toHaveBeenCalledWith('tenant-a');
    expect(saveMessage).toHaveBeenCalledTimes(1);
    const [context, message, metadata] = saveMessage.mock.calls[0];
    expect(context).toEqual({
      userId: 'user-1',
      isTemporary: true,
      expiredAt: new Date('2026-11-27T00:00:00.000Z'),
      interfaceConfig: { retentionMode: 'all' },
    });
    expect(message).toMatchObject({
      messageId: 'response-1',
      parentMessageId: 'user-msg-1',
      conversationId,
      content: [{ type: 'text', text: 'Hello dead owner' }],
      text: 'Hello dead owner',
      sender: 'Agent',
      agent_id: 'agent_abc',
      unfinished: true,
      error: false,
      isCreatedByUser: false,
      user: 'user-1',
    });
    expect(metadata.context).toContain('orphanedGeneration');
    expect(seenTenants).toEqual(['tenant-a']);
  });

  it('falls back to the preliminary response id and runs without a tenant', async () => {
    const saveMessage = jest.fn(async () => ({}));
    const handler = createOrphanedGenerationHandler({ saveMessage, getMessages });

    await handler(
      conversationId,
      buildResult({ jobData: { responseMessageId: undefined, tenantId: undefined } }),
    );

    expect(saveMessage.mock.calls[0][1].messageId).toBe('user-msg-1_');
    expect(saveMessage.mock.calls[0][0].interfaceConfig).toBeUndefined();
  });

  it('upserts the same row when called twice', async () => {
    const saveMessage = jest.fn(async () => ({}));
    const handler = createOrphanedGenerationHandler({ saveMessage, getMessages });

    await handler(conversationId, buildResult());
    await handler(conversationId, buildResult());

    expect(saveMessage).toHaveBeenCalledTimes(2);
    expect(saveMessage.mock.calls[0][1].messageId).toBe(saveMessage.mock.calls[1][1].messageId);
  });

  it('writes nothing when there is no content and no announced response', async () => {
    const saveMessage = jest.fn();
    const handler = createOrphanedGenerationHandler({ saveMessage, getMessages });

    await handler(conversationId, buildResult({ result: { content: [], text: '' } }));

    expect(saveMessage).not.toHaveBeenCalled();
  });

  it('writes an empty unfinished row when a created event announced the response', async () => {
    const saveMessage = jest.fn(async () => ({}));
    const handler = createOrphanedGenerationHandler({ saveMessage, getMessages });

    await handler(
      conversationId,
      buildResult({
        result: { content: [], text: '' },
        jobData: { createdEventEmitted: true },
      }),
    );

    expect(saveMessage).toHaveBeenCalledTimes(1);
    expect(saveMessage.mock.calls[0][1]).toMatchObject({
      messageId: 'response-1',
      parentMessageId: 'user-msg-1',
      content: [],
      text: '',
      unfinished: true,
      error: false,
    });
  });

  it('saves the user message first when it is not in Mongo yet', async () => {
    const saveMessage = jest.fn(async () => ({}));
    const handler = createOrphanedGenerationHandler({
      saveMessage,
      getMessages: jest.fn(async () => []),
    });

    await handler(conversationId, buildResult());

    expect(saveMessage).toHaveBeenCalledTimes(2);
    expect(saveMessage.mock.calls[0][1]).toMatchObject({
      messageId: 'user-msg-1',
      parentMessageId: 'root',
      conversationId,
      text: 'hi',
      sender: 'User',
      isCreatedByUser: true,
      user: 'user-1',
    });
    expect(saveMessage.mock.calls[1][1]).toMatchObject({ messageId: 'response-1' });
  });

  it('still attempts the response when the user prerequisite fails, then throws', async () => {
    const saveMessage = jest
      .fn()
      .mockRejectedValueOnce(new Error('user write failed'))
      .mockResolvedValueOnce({});
    const handler = createOrphanedGenerationHandler({
      saveMessage,
      getMessages: jest.fn(async () => []),
    });

    await expect(handler(conversationId, buildResult())).rejects.toThrow('user write failed');
    expect(saveMessage).toHaveBeenCalledTimes(2);
  });

  it('throws when the row was not persisted, so the abort publishes a reconcile frame', async () => {
    const handler = createOrphanedGenerationHandler({
      saveMessage: jest.fn(async () => null),
      getMessages,
    });

    await expect(handler(conversationId, buildResult())).rejects.toThrow('was not persisted');
  });

  it('saves without the interface config when it cannot be loaded', async () => {
    const saveMessage = jest.fn(async () => ({}));
    const handler = createOrphanedGenerationHandler({
      saveMessage,
      getMessages,
      getInterfaceConfig: jest.fn(async () => {
        throw new Error('config unavailable');
      }),
    });

    await handler(conversationId, buildResult());

    expect(saveMessage).toHaveBeenCalledTimes(1);
    expect(saveMessage.mock.calls[0][0].interfaceConfig).toBeUndefined();
  });
});
