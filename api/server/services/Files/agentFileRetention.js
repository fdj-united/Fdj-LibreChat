const path = require('path');
const fs = require('fs').promises;
const mongoose = require('mongoose');
const { logger } = require('@librechat/data-schemas');
const { sweepAgentFiles, startAgentFileRetentionSweep } = require('@librechat/api');

/**
 * Identify the local `message_attachment` uploads that belong to a single agent
 * and were uploaded at or before `cutoff`.
 *
 * The join is: `conversations.agent_id` → each conversation's `messages` →
 * `messages.files[]` / `messages.attachments[]` file ids → `files` rows that are
 * local, live under `/uploads/`, and are old enough. This deliberately excludes:
 *   - images (stored under `/images/...`, not `/uploads/`);
 *   - RAG / file_search and agent skill / code-env files (never referenced as a
 *     conversation message attachment);
 *   - non-local files (S3/minio) via `source: 'local'`.
 *
 * @param {string} agentId
 * @param {Date} cutoff
 * @returns {Promise<Array<{ file_id: string, filepath: string, user: string }>>}
 */
async function getExpiredAgentUploads(agentId, cutoff) {
  const Conversation = mongoose.models.Conversation;
  const Message = mongoose.models.Message;
  const File = mongoose.models.File;
  if (!Conversation || !Message || !File) {
    throw new Error('[agentFileRetention] Required models are not registered');
  }

  const convos = await Conversation.find({ agent_id: agentId }, 'conversationId').lean();
  const conversationIds = convos.map((c) => c.conversationId).filter(Boolean);
  if (conversationIds.length === 0) {
    return [];
  }

  const messages = await Message.find(
    {
      conversationId: { $in: conversationIds },
      $or: [{ files: { $exists: true, $ne: [] } }, { attachments: { $exists: true, $ne: [] } }],
    },
    'files attachments',
  ).lean();

  const fileIds = new Set();
  for (const message of messages) {
    for (const file of message.files || []) {
      if (file && file.file_id) {
        fileIds.add(file.file_id);
      }
    }
    for (const attachment of message.attachments || []) {
      if (attachment && attachment.file_id) {
        fileIds.add(attachment.file_id);
      }
    }
  }
  if (fileIds.size === 0) {
    return [];
  }

  const files = await File.find(
    {
      file_id: { $in: [...fileIds] },
      source: 'local',
      filepath: { $regex: '^/uploads/' },
      createdAt: { $lte: cutoff },
    },
    'file_id filepath user',
  ).lean();

  return files
    .filter((f) => f && typeof f.filepath === 'string' && f.user != null)
    .map((f) => ({ file_id: f.file_id, filepath: f.filepath, user: String(f.user) }));
}

/**
 * Build a disk-only deleter bound to the resolved local uploads directory.
 * Unlinks only the physical file and never touches the database, RAG, or any
 * file outside `<uploadsBase>/<user>/`.
 *
 * @param {string} uploadsBase - Absolute path of the local uploads directory.
 * @returns {(candidate: { filepath: string, user: string }) => Promise<'deleted' | 'missing'>}
 */
function createDeleteDiskFile(uploadsBase) {
  return async function deleteDiskFile({ filepath, user }) {
    /** Strip any query string (e.g. `?manual=true`). */
    const cleanFilepath = String(filepath).split('?')[0];
    const expectedPrefix = `/uploads/${user}/`;
    if (!cleanFilepath.startsWith(expectedPrefix)) {
      throw new Error(
        `[agentFileRetention] Refusing to delete file outside the owner's uploads: ${cleanFilepath}`,
      );
    }

    const relativeName = cleanFilepath.slice(expectedPrefix.length);
    if (!relativeName) {
      throw new Error(`[agentFileRetention] Invalid file path: ${cleanFilepath}`);
    }

    const userUploadDir = path.join(uploadsBase, user);
    const physicalPath = path.join(userUploadDir, relativeName);

    /** Path-traversal guard: resolved path must stay within `<uploadsBase>/<user>/`. */
    const rel = path.relative(userUploadDir, physicalPath);
    if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) {
      throw new Error(
        `[agentFileRetention] Refusing to delete file outside uploads dir: ${physicalPath}`,
      );
    }

    try {
      await fs.unlink(physicalPath);
      return 'deleted';
    } catch (error) {
      if (error && error.code === 'ENOENT') {
        return 'missing';
      }
      throw error;
    }
  };
}

/**
 * Start the recurring, per-agent, disk-only retention sweep from app config.
 * No-ops (returns null) when no rules are configured or the local uploads path
 * is unavailable. Never throws.
 *
 * @param {import('@librechat/data-schemas').AppConfig} appConfig
 * @returns {NodeJS.Timeout | null}
 */
function startAgentFileRetention(appConfig) {
  const config = appConfig?.fileRetention;
  const rules = config?.agents ?? [];
  if (!Array.isArray(rules) || rules.length === 0) {
    return null;
  }

  const uploadsBase = appConfig?.paths?.uploads;
  if (!uploadsBase || typeof uploadsBase !== 'string') {
    logger.warn(
      '[agentFileRetention] Disabled: local uploads path is not configured (paths.uploads missing)',
    );
    return null;
  }

  return startAgentFileRetentionSweep(
    {
      rules,
      intervalMs: config?.intervalMs,
      dryRun: config?.dryRun,
    },
    {
      getExpiredAgentUploads,
      deleteDiskFile: createDeleteDiskFile(uploadsBase),
      sweepAgentFiles,
      logger,
    },
  );
}

module.exports = {
  startAgentFileRetention,
  getExpiredAgentUploads,
  createDeleteDiskFile,
};
