import { QueryClient } from '@tanstack/react-query';
import { Constants, QueryKeys } from 'librechat-data-provider';
import type { EventSubmission, TMessage } from 'librechat-data-provider';
import {
  buildCreatedInitialResponse,
  commitFinalMessages,
  getExistingConversationAbortMessages,
  isFinalEventForActiveConversation,
  isInitialNewConversationSubmission,
  mergeRegenerateFinalMessages,
  refetchFinalMessages,
  shouldRefetchFinalMessages,
} from '~/hooks/SSE/useEventHandlers';

describe('commitFinalMessages', () => {
  const messages = [
    {
      messageId: 'user-1',
      conversationId: 'conversation-1',
      isCreatedByUser: true,
      sender: 'User',
      text: 'Hello',
    } as TMessage,
  ];

  it('restores the conversation cache when the active cache was empty', () => {
    const queryClient = new QueryClient();
    const setMessages = jest.fn();

    commitFinalMessages({
      queryClient,
      setMessages,
      conversationId: 'conversation-1',
      messages,
      updateActiveView: false,
    });

    expect(queryClient.getQueryData([QueryKeys.messages, 'conversation-1'])).toEqual(messages);
    expect(setMessages).not.toHaveBeenCalled();
  });

  it('updates both caches while the submitted conversation is active', () => {
    const queryClient = new QueryClient();
    const setMessages = jest.fn();

    commitFinalMessages({
      queryClient,
      setMessages,
      conversationId: 'conversation-1',
      messages,
      updateActiveView: true,
    });

    expect(queryClient.getQueryData([QueryKeys.messages, 'conversation-1'])).toEqual(messages);
    expect(setMessages).toHaveBeenCalledWith(messages);
  });
});

describe('final message reconciliation', () => {
  it('treats the matching route as active even when its message cache is empty', () => {
    expect(
      isFinalEventForActiveConversation({
        activeConversationId: 'conversation-1',
        submissionConversationId: 'conversation-1',
        finalConversationId: 'conversation-1',
      }),
    ).toBe(true);
  });

  it('does not update the active view after navigation to another conversation', () => {
    expect(
      isFinalEventForActiveConversation({
        activeConversationId: 'conversation-2',
        submissionConversationId: 'conversation-1',
        finalConversationId: 'conversation-1',
      }),
    ).toBe(false);
  });

  it('refetches canonical messages after an active persisted conversation finalizes', () => {
    expect(
      shouldRefetchFinalMessages({
        activeConversation: true,
        conversationId: 'conversation-1',
        isTemporary: false,
      }),
    ).toBe(true);
  });

  it('invalidates and actively refetches only the finalized conversation messages', async () => {
    const queryClient = new QueryClient();
    const invalidateQueries = jest.spyOn(queryClient, 'invalidateQueries');

    await refetchFinalMessages({ queryClient, conversationId: 'conversation-1' });

    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: [QueryKeys.messages, 'conversation-1'],
      exact: true,
      refetchType: 'active',
    });
  });

  it.each([
    {
      activeConversation: false,
      conversationId: 'conversation-1',
      isTemporary: false,
    },
    {
      activeConversation: true,
      conversationId: 'conversation-1',
      isTemporary: true,
    },
    {
      activeConversation: true,
      conversationId: String(Constants.NEW_CONVO),
      isTemporary: false,
    },
  ])('does not refetch when canonical reconciliation is not applicable', (scenario) => {
    expect(shouldRefetchFinalMessages(scenario)).toBe(false);
  });
});

describe('buildCreatedInitialResponse', () => {
  const userMessage = {
    messageId: 'server-user-message',
    conversationId: 'conversation-1',
    isCreatedByUser: true,
    text: 'Hello',
    sender: 'User',
  } as TMessage;

  const initialResponse = {
    messageId: 'prelim-response',
    parentMessageId: 'original-user-message',
    conversationId: 'conversation-1',
    isCreatedByUser: false,
    text: '',
    sender: 'Assistant',
  } as TMessage;

  it('uses the created user message id for new turns', () => {
    expect(
      buildCreatedInitialResponse({
        initialResponse,
        userMessage,
        isRegenerate: false,
      }),
    ).toEqual(
      expect.objectContaining({
        messageId: 'server-user-message_',
        parentMessageId: 'server-user-message',
      }),
    );
  });

  it('preserves the regenerated prelim response id and parent', () => {
    expect(
      buildCreatedInitialResponse({
        initialResponse,
        userMessage,
        isRegenerate: true,
      }),
    ).toEqual(
      expect.objectContaining({
        messageId: 'prelim-response',
        parentMessageId: 'original-user-message',
      }),
    );
  });
});

describe('isInitialNewConversationSubmission', () => {
  it('treats a root user message as an optimistic new chat', () => {
    expect(
      isInitialNewConversationSubmission({
        userMessage: {
          messageId: 'user-1',
          parentMessageId: Constants.NO_PARENT,
        } as TMessage,
      } as EventSubmission),
    ).toBe(true);
  });

  it('does not treat follow-up turns as optimistic new chats', () => {
    expect(
      isInitialNewConversationSubmission({
        userMessage: {
          messageId: 'user-2',
          parentMessageId: 'assistant-1',
        } as TMessage,
      } as EventSubmission),
    ).toBe(false);
  });
});

describe('mergeRegenerateFinalMessages', () => {
  const userMessage = (messageId: string, parentMessageId: string = Constants.NO_PARENT) =>
    ({
      messageId,
      parentMessageId,
      conversationId: 'conversation-1',
      isCreatedByUser: true,
      sender: 'User',
      text: messageId,
    }) as TMessage;

  const assistantMessage = (messageId: string, parentMessageId: string) =>
    ({
      messageId,
      parentMessageId,
      conversationId: 'conversation-1',
      isCreatedByUser: false,
      sender: 'Assistant',
      text: messageId,
    }) as TMessage;

  it('keeps the original branch siblings when a non-tail regenerate finalizes', () => {
    const rootUser = userMessage('user-1');
    const originalResponse = assistantMessage('assistant-1', rootUser.messageId);
    const followUpUser = userMessage('user-2', originalResponse.messageId);
    const followUpResponse = assistantMessage('assistant-2', followUpUser.messageId);
    const finalResponse = assistantMessage('assistant-3', rootUser.messageId);

    expect(
      mergeRegenerateFinalMessages({
        messages: [rootUser, originalResponse, followUpUser, followUpResponse],
        responseMessage: finalResponse,
        initialResponseId: 'assistant-1_',
      }).map((message) => message.messageId),
    ).toEqual([
      rootUser.messageId,
      originalResponse.messageId,
      followUpUser.messageId,
      followUpResponse.messageId,
      finalResponse.messageId,
    ]);
  });

  it('replaces the streamed preliminary response when it is present', () => {
    const rootUser = userMessage('user-1');
    const preliminaryResponse = assistantMessage('assistant-1_', rootUser.messageId);
    const finalResponse = assistantMessage('assistant-3', rootUser.messageId);

    expect(
      mergeRegenerateFinalMessages({
        messages: [rootUser, preliminaryResponse],
        responseMessage: finalResponse,
        initialResponseId: preliminaryResponse.messageId,
      }).map((message) => message.messageId),
    ).toEqual([rootUser.messageId, finalResponse.messageId]);
  });
});

describe('getExistingConversationAbortMessages', () => {
  const message = (messageId: string) =>
    ({
      messageId,
      conversationId: 'conversation-1',
      text: messageId,
    }) as TMessage;

  it('restores the full pre-regenerate branch on early abort', () => {
    const originalMessages = [message('user-1'), message('assistant-1'), message('user-2')];
    const scopedRegenerateMessages = [message('user-1')];
    const currentStreamMessages = [message('user-1'), message('assistant-1_')];

    expect(
      getExistingConversationAbortMessages({
        messages: scopedRegenerateMessages,
        currentMessages: currentStreamMessages,
        regenerateMessages: originalMessages,
        isRegenerate: true,
      }).map(({ messageId }) => messageId),
    ).toEqual(['user-1', 'assistant-1', 'user-2']);
  });

  it('keeps the existing non-regenerate abort rollback behavior', () => {
    const submissionMessages = [message('user-1')];
    const currentMessages = [message('user-1'), message('assistant-1')];

    expect(
      getExistingConversationAbortMessages({
        messages: submissionMessages,
        currentMessages,
      }).map(({ messageId }) => messageId),
    ).toEqual(['user-1']);
  });
});
