const { logger, tenantStorage } = require('@librechat/data-schemas');
const { filterPersistableAbortContent, buildAbortedResponseMetadata } = require('@librechat/api');

const SAVE_CONTEXT =
  'api/server/services/Endpoints/agents/orphanedGeneration.js - dead owner partial';

/**
 * Build the host hook that persists the partial response of a generation whose owner
 * died (SIGKILL, OOM, node loss). The manager calls it as the `beforePublish` of its own
 * abort, before a successor replaces the generation and deletes its chunk log.
 *
 * There is no request here: the user, tenant and retention context all come from the
 * job hash, the same fields the abort route reads for a stopped generation. The write is
 * an upsert keyed by the response messageId, so a repeated salvage updates the same row.
 *
 * @param {object} deps
 * @param {Function} deps.saveMessage - `saveMessage(context, message, metadata)` from `~/models`.
 * @param {(tenantId?: string) => Promise<object | undefined>} [deps.getInterfaceConfig] -
 *   Resolves the interface config that drives retention when the job carries no expiry.
 * @returns {(streamId: string, result: import('@librechat/api').AbortResult) => Promise<void>}
 */
function createOrphanedGenerationHandler({ saveMessage, getInterfaceConfig }) {
  if (typeof saveMessage !== 'function') {
    throw new TypeError('createOrphanedGenerationHandler requires saveMessage');
  }

  return async function persistOrphanedGeneration(streamId, result) {
    const jobData = result?.jobData;
    const userId = jobData?.userId;
    const conversationId = jobData?.conversationId;
    const parentMessageId = jobData?.userMessage?.messageId;
    const content = filterPersistableAbortContent(
      Array.isArray(result?.content) ? result.content : [],
    );
    if (!userId || !conversationId || !parentMessageId || content.length === 0) {
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

      const responseMessage = {
        messageId,
        parentMessageId,
        conversationId,
        content,
        text: result.text || '',
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

      const saved = await saveMessage(
        {
          userId,
          isTemporary: jobData.isTemporary,
          expiredAt: jobData.retentionExpiresAt ? new Date(jobData.retentionExpiresAt) : undefined,
          interfaceConfig,
        },
        responseMessage,
        { context: SAVE_CONTEXT },
      );
      if (!saved) {
        throw new Error('Orphaned generation partial response was not persisted');
      }
      logger.info(
        `[OrphanedGeneration] Saved partial response of dead owner for ${streamId} (messageId=${messageId}, parts=${content.length})`,
      );
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
