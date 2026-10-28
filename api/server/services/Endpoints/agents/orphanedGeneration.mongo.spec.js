const mongoose = require('mongoose');
const { v4 } = require('uuid');
const { MongoMemoryServer } = require('mongodb-memory-server');

/** Registers the mongoose models the message methods use. */
require('~/db/models');
const { saveMessage, getMessages } = require('~/models');
const { createOrphanedGenerationHandler } = require('./orphanedGeneration');

/** The dead owner's salvage against the real message methods, with no request context. */
describe('orphaned generation salvage (Mongo)', () => {
  let mongoServer;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    await mongoose.connect(mongoServer.getUri());
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongoServer.stop();
  });

  function buildResult({ user, conversationId, content, createdEventEmitted = false }) {
    return {
      success: true,
      text: content.map((part) => part.text ?? '').join(''),
      content,
      collectedUsage: [],
      finalEvent: null,
      jobData: {
        streamId: conversationId,
        userId: user,
        status: 'aborted',
        createdAt: Date.now(),
        conversationId,
        responseMessageId: `${conversationId}-response`,
        userMessage: {
          messageId: `${conversationId}-user`,
          parentMessageId: '00000000-0000-0000-0000-000000000000',
          text: 'tell me a story',
        },
        sender: 'Agent',
        endpoint: 'agents',
        model: 'claude',
        createdEventEmitted,
      },
    };
  }

  const handler = createOrphanedGenerationHandler({ saveMessage, getMessages });

  it('saves the missing user message and the partial response under it', async () => {
    const user = new mongoose.Types.ObjectId().toString();
    const conversationId = v4();

    await handler(
      conversationId,
      buildResult({
        user,
        conversationId,
        content: [{ type: 'text', text: 'Once upon a' }],
      }),
    );

    const rows = await getMessages({ conversationId, user });
    expect(rows).toHaveLength(2);
    const request = rows.find((row) => row.isCreatedByUser);
    const response = rows.find((row) => !row.isCreatedByUser);
    expect(request).toMatchObject({
      messageId: `${conversationId}-user`,
      text: 'tell me a story',
    });
    expect(response).toMatchObject({
      messageId: `${conversationId}-response`,
      parentMessageId: request.messageId,
      unfinished: true,
      error: false,
    });
    expect(response.content).toEqual([expect.objectContaining({ text: 'Once upon a' })]);
  });

  it('leaves an existing user message untouched and converges on one response row', async () => {
    const user = new mongoose.Types.ObjectId().toString();
    const conversationId = v4();
    await saveMessage(
      { userId: user },
      {
        messageId: `${conversationId}-user`,
        conversationId,
        parentMessageId: '00000000-0000-0000-0000-000000000000',
        text: 'original text with files',
        isCreatedByUser: true,
        sender: 'User',
      },
    );
    const result = buildResult({
      user,
      conversationId,
      content: [{ type: 'text', text: 'partial' }],
    });

    await handler(conversationId, result);
    await handler(conversationId, result);

    const rows = await getMessages({ conversationId, user });
    expect(rows).toHaveLength(2);
    expect(rows.find((row) => row.isCreatedByUser).text).toBe('original text with files');
  });

  it('saves an empty unfinished row for an announced response with no content', async () => {
    const user = new mongoose.Types.ObjectId().toString();
    const conversationId = v4();

    await handler(
      conversationId,
      buildResult({ user, conversationId, content: [], createdEventEmitted: true }),
    );

    const [response] = await getMessages({
      conversationId,
      user,
      messageId: `${conversationId}-response`,
    });
    expect(response).toMatchObject({ unfinished: true, error: false, content: [] });
  });
});
