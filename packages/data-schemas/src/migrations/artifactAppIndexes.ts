import type { Connection } from 'mongoose';
import { buildIndexWithRetry } from '~/utils/retry';
import logger from '~/config/winston';

type IndexSpec = Record<string, 1 | -1>;
type IndexOptions = {
  unique?: boolean;
  partialFilterExpression?: Record<string, { $type: 'string' }>;
};

interface IndexDefinition {
  spec: IndexSpec;
  options: IndexOptions;
}

/**
 * Compound tenant-scoped indexes for the artifact app collections (PLAN §6.4).
 * Mongoose auto-creates these from the schema on model init, but a fresh
 * deployment or a restore-from-dump may not have run model init yet. This
 * migration ensures the indexes exist. It is idempotent — createIndex is a
 * no-op when the index already exists with the same definition.
 */
const COLLECTION_INDEXES: Record<string, IndexDefinition[]> = {
  artifactapps: [
    { spec: { tenantId: 1, artifactAppId: 1 }, options: { unique: true } },
    { spec: { tenantId: 1, status: 1, visibility: 1 }, options: {} },
    { spec: { tenantId: 1, 'marketplace.listed': 1, 'marketplace.featured': 1 }, options: {} },
    { spec: { tenantId: 1, createdBy: 1 }, options: {} },
    { spec: { tenantId: 1, updatedAt: -1, _id: -1 }, options: {} },
    { spec: { tenantId: 1, createdBy: 1, updatedAt: -1, _id: -1 }, options: {} },
    { spec: { tenantId: 1, activeVersionId: 1 }, options: {} },
    {
      spec: {
        tenantId: 1,
        createdBy: 1,
        'sourceMetadata.conversationId': 1,
        'sourceMetadata.sourceKey': 1,
      },
      options: {
        unique: true,
        partialFilterExpression: {
          'sourceMetadata.conversationId': { $type: 'string' },
          'sourceMetadata.sourceKey': { $type: 'string' },
        },
      },
    },
    {
      spec: {
        tenantId: 1,
        createdBy: 1,
        'sourceMetadata.detachedConversationId': 1,
        'sourceMetadata.sourceKey': 1,
      },
      options: {
        partialFilterExpression: {
          'sourceMetadata.detachedConversationId': { $type: 'string' },
          'sourceMetadata.sourceKey': { $type: 'string' },
        },
      },
    },
  ],
  artifactversions: [
    { spec: { tenantId: 1, artifactAppId: 1, versionNumber: 1 }, options: { unique: true } },
    { spec: { tenantId: 1, artifactVersionId: 1 }, options: { unique: true } },
  ],
  artifactsourcetombstones: [
    { spec: { tenantId: 1, createdBy: 1, conversationId: 1 }, options: { unique: true } },
  ],
};

const ARTIFACT_INDEX_MODELS = [
  'ArtifactApp',
  'ArtifactVersion',
  'ArtifactSourceTombstone',
] as const;

/** Mongoose starts each model's automatic index build in the background.
 *  An explicit `createIndex` that overlaps it is a second concurrent build,
 *  which single-build engines reject. Letting `init()` settle first keeps
 *  the migration from waiting on (or colliding with) that slot. */
async function settleAutomaticIndexes(connection: Connection): Promise<void> {
  for (const modelName of ARTIFACT_INDEX_MODELS) {
    const model = connection.models[modelName];
    if (typeof model?.init === 'function') {
      await model.init().catch(() => undefined);
    }
  }
}

export async function ensureArtifactAppIndexes(
  connection: Connection,
): Promise<{ created: string[]; errors: string[] }> {
  await connection.asPromise();
  await settleAutomaticIndexes(connection);
  const result = { created: [] as string[], errors: [] as string[] };

  for (const [collectionName, indexes] of Object.entries(COLLECTION_INDEXES)) {
    const collection = connection.db!.collection(collectionName);
    for (const { spec, options } of indexes) {
      try {
        const name = await buildIndexWithRetry(
          () => collection.createIndex(spec, options),
          `${collectionName}.${JSON.stringify(spec)}`,
        );
        if (!name) {
          throw new Error('Index creation returned no name');
        }
        result.created.push(`${collectionName}.${name}`);
      } catch (err) {
        const msg = `${collectionName}.${JSON.stringify(spec)}: ${(err as Error).message}`;
        result.errors.push(msg);
        logger.error(`[ArtifactAppMigration] Failed to create index: ${msg}`);
      }
    }
  }

  logger.info(
    `[ArtifactAppMigration] Ensured artifact app indexes. Created/confirmed ${result.created.length}.`,
  );
  if (result.errors.length > 0) {
    throw new Error(
      `[ArtifactAppMigration] ${result.errors.length} required index operation(s) failed: ${result.errors.join('; ')}`,
    );
  }
  return result;
}

export { COLLECTION_INDEXES };
