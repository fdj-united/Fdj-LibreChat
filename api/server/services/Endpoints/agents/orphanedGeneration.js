const { logger, tenantStorage } = require('@librechat/data-schemas');
const {
  filterPersistableAbortContent,
  hasPersistableAbortContent,
  buildAbortedResponseMetadata,
} = require('@librechat/api');

const SAVE_CONTEXT =
  'api/server/services/Endpoints/agents/orphanedGeneration.js - dead owner partial';
const USER_SAVE_CONTEXT =
  'api/server/services/Endpoints/agents/orphanedGeneration.js - dead owner user prerequisite';

/**
 * Build the host hook that persists the partial response of a generation whose owner
 * died (SIGKILL, OOM, node loss), before a successor's replacement deletes its chunk log.
 *
 * It mirrors the Stop route's abort persistence (routes/agents/index.js `beforePublish`):
 * - the user message is saved first when it is not in Mongo yet (the owner writes it
 *   fire-and-forget at start, so an early kill can leave the response without a parent);
 * - the response is saved when it has persistable content, or, with no content, when a
 *   `created` event already announced its messageId to the client (an empty unfinished
 *   row, so a follow-up parented on that id is not rejected);
 * - both writes are attempted, and any failure is logged at error level and rethrown.
 *   The manager treats a throw as "persistence failed"; the successor's turn proceeds.
 *
 * There is no request here: the user, tenant and retention context come from the job
 * hash. Both writes are upserts keyed by messageId, so a repeated salvage converges.
 *
 * @param {object} deps
 * @param {Function} deps.saveMessage - `saveMessage(context, message, metadata)` from `~/models`.
 * @param {Function} [deps.getMessages] - `getMessages(filter, select)` from `~/models`; used
 *   to skip rewriting a user message that already exists. Without it the user message is
 *   upserted, as the Stop route does.
 * @param {(tenantId?: string) => Promise<object | undefined>} [deps.getInterfaceConfig] -
 *   Resolves the interface config that drives retention when the job carries no expiry.
 * @returns {(streamId: string, result: import('@librechat/api').AbortResult) => Promise<void>}
 */
function createOrphanedGenerationHandler({ saveMessage, getMessages, getInterfaceConfig }) {
  if (typeof saveMessage !== 'function') {
    throw new TypeError('createOrphanedGenerationHandler requires saveMessage');
  }

  return async function persistOrphanedGeneration(streamId, result) {
    const jobData = result?.jobData;
    const userId = jobData?.userId;
    const conversationId = jobData?.conversationId;
    const userMessage = jobData?.userMessage;
    const parentMessageId = userMessage?.messageId;
    const rawContent = Array.isArray(result?.content) ? result.content : [];
    const content = filterPersistableAbortContent(rawContent);
    const hasContent = hasPersistableAbortContent(rawContent) && content.length > 0;
    /** With no content, only a response the client was already told about is persisted. */
    const announcedResponseId =
      jobData?.createdEventEmitted === true ? jobData?.responseMessageId : undefined;
    if (
      !userId ||
      !conversationId ||
      !parentMessageId ||
      (!hasContent && announcedResponseId == null)
    ) {
      logger.info(
        `[OrphanedGeneration] Nothing to save for ${streamId} (parts=${content.length}, user=${Boolean(userId)}, parent=${Boolean(parentMessageId)})`,
      );
      return;
    }

    const tenantId = jobData.tenantId;
    const messageId = jobData.responseMessageId ?? `${parentMessageId}_`;
    const run = async () => {
      let interfaceConfig;
      if (getInterfaceConfig != null) {
        try {
          interfaceConfig = await getInterfaceConfig(tenantId);
        } catch (error) {
          logger.warn(
            `[OrphanedGeneration] Failed to load interface config for ${streamId}; saving without it`,
            error,
          );
        }
      }
      const messageContext = {
        userId,
        isTemporary: jobData.isTemporary,
        expiredAt: jobData.retentionExpiresAt ? new Date(jobData.retentionExpiresAt) : undefined,
        interfaceConfig,
      };
      const persistenceErrors = [];

      try {
        const existing =
          getMessages != null
            ? await getMessages({ messageId: parentMessageId, user: userId }, 'messageId')
            : [];
        if (!Array.isArray(existing) || existing.length === 0) {
          const savedRequest = await saveMessage(
            messageContext,
            {
              ...userMessage,
              conversationId,
              sender: 'User',
              endpoint: jobData.endpoint,
              isCreatedByUser: true,
              user: userId,
            },
            { context: USER_SAVE_CONTEXT },
          );
          if (!savedRequest) {
            throw new Error('Orphaned generation user prerequisite was not persisted');
          }
        }
      } catch (error) {
        persistenceErrors.push(error);
      }

      try {
        const responseMessage = {
          messageId,
          parentMessageId,
          conversationId,
          content: hasContent ? content : [],
          text: hasContent ? result.text || '' : '',
          sender: jobData.sender || 'AI',
          endpoint: jobData.endpoint,
          iconURL: jobData.iconURL,
          model: jobData.model,
          unfinished: true,
          error: false,
          isCreatedByUser: false,
          ...(jobData.agent_id != null && { agent_id: jobData.agent_id }),
          ...(Array.isArray(jobData.userSubmittedPaths) &&
            jobData.userSubmittedPaths.length > 0 && {
              userSubmittedPaths: jobData.userSubmittedPaths,
            }),
          ...(Array.isArray(jobData.userSubmittedMessageFieldPaths) &&
            jobData.userSubmittedMessageFieldPaths.length > 0 && {
              userSubmittedMessageFieldPaths: jobData.userSubmittedMessageFieldPaths,
            }),
          contextMeta: jobData.contextMeta ?? null,
          user: userId,
        };
        const abortMetadata = buildAbortedResponseMetadata(jobData);
        if (abortMetadata) {
          responseMessage.metadata = abortMetadata;
        }
        const saved = await saveMessage(messageContext, responseMessage, {
          context: SAVE_CONTEXT,
        });
        if (!saved) {
          throw new Error('Orphaned generation partial response was not persisted');
        }
        logger.info(
          `[OrphanedGeneration] Saved partial response of dead owner for ${streamId} (messageId=${messageId}, parts=${responseMessage.content.length})`,
        );
      } catch (error) {
        persistenceErrors.push(error);
      }

      if (persistenceErrors.length === 1) {
        throw persistenceErrors[0];
      }
      if (persistenceErrors.length > 1) {
        const error = new Error('Orphaned generation user and response persistence failed');
        error.causes = persistenceErrors;
        throw error;
      }
    };

    try {
      return tenantId ? await tenantStorage.run({ tenantId, userId }, run) : await run();
    } catch (error) {
      logger.error(
        `[OrphanedGeneration] Failed to save partial response of dead owner for ${streamId}`,
        error,
      );
      throw error;
    }
  };
}

module.exports = { createOrphanedGenerationHandler };
