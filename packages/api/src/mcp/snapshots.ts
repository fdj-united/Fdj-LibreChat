import { createHash } from 'crypto';
import { logger } from '@librechat/data-schemas';
import type { IToken, TokenCreateData, TokenQuery } from '@librechat/data-schemas';
import type { LCAvailableTools } from './types';

export const MCP_TOOL_SNAPSHOT_TOKEN_TYPE = 'mcp_tool_snapshot';
/** Long enough to outlive OAuth sessions; each fresh discovery re-arms it. */
export const DEFAULT_MCP_TOOL_SNAPSHOT_TTL_SECONDS: number = 30 * 24 * 60 * 60;

export interface MCPToolSnapshotDeps {
  findToken: (query: TokenQuery) => Promise<IToken | null>;
  createToken: (data: TokenCreateData) => Promise<IToken>;
  deleteTokens: (query: TokenQuery) => Promise<unknown>;
  ttlSeconds?: number;
}

export interface MCPToolSnapshots {
  /** Last tool definitions discovered for this user and server, or `null` when none are stored. */
  load: (userId: string, serverName: string) => Promise<LCAvailableTools | null>;
  /** Persists definitions from a successful discovery; unchanged definitions are not rewritten. */
  save: (userId: string, serverName: string, tools: LCAvailableTools) => Promise<void>;
  remove: (userId: string, serverName: string) => Promise<void>;
}

interface LazyOAuthServerConfig {
  requiresOAuth?: boolean;
  oauth?: unknown;
}

/** Servers whose sign-in may be deferred until one of their tools is called. */
export function isLazyOAuthServer(config?: LazyOAuthServerConfig | null): boolean {
  return (
    config?.requiresOAuth === true || (config?.oauth != null && config.requiresOAuth !== false)
  );
}

function isAvailableTools(value: unknown): value is LCAvailableTools {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const entries = Object.values(value as Record<string, unknown>);
  return (
    entries.length > 0 &&
    entries.every((entry) => {
      const fn = (entry as { function?: { name?: unknown } } | null)?.function;
      return typeof fn?.name === 'string';
    })
  );
}

function digest(serialized: string): string {
  return createHash('sha256').update(serialized).digest('hex');
}

/**
 * Keeps each user's last discovered MCP tool definitions in the Token collection so a turn can
 * expose an OAuth server's tools without connecting to it. Definitions carry no credentials;
 * sign-in still happens through the regular tool-call OAuth flow when a tool is invoked.
 */
export function createMCPToolSnapshots(deps: MCPToolSnapshotDeps): MCPToolSnapshots {
  const ttlSeconds = deps.ttlSeconds ?? DEFAULT_MCP_TOOL_SNAPSHOT_TTL_SECONDS;
  /** Digest plus when it was last persisted; re-saving after half the TTL keeps the record alive. */
  const knownDigests = new Map<string, { digest: string; savedAt: number }>();
  const refreshAfterMs = (ttlSeconds * 1000) / 2;
  const key = (userId: string, serverName: string) => `${userId}:${serverName}`;
  const query = (userId: string, serverName: string): TokenQuery => ({
    userId,
    type: MCP_TOOL_SNAPSHOT_TOKEN_TYPE,
    identifier: `mcp:${serverName}:tools`,
  });

  async function remove(userId: string, serverName: string): Promise<void> {
    knownDigests.delete(key(userId, serverName));
    await deps.deleteTokens(query(userId, serverName));
  }

  async function load(userId: string, serverName: string): Promise<LCAvailableTools | null> {
    const record = await deps.findToken(query(userId, serverName));
    if (!record?.token) {
      return null;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(record.token);
    } catch {
      parsed = undefined;
    }
    if (!isAvailableTools(parsed)) {
      logger.warn('[MCP Tool Snapshot] Discarding an unreadable snapshot', { serverName });
      await remove(userId, serverName);
      return null;
    }
    const createdAt = record.createdAt ? new Date(record.createdAt).getTime() : Date.now();
    knownDigests.set(key(userId, serverName), { digest: digest(record.token), savedAt: createdAt });
    return parsed;
  }

  async function save(userId: string, serverName: string, tools: LCAvailableTools): Promise<void> {
    if (!isAvailableTools(tools)) {
      return;
    }
    const serialized = JSON.stringify(tools);
    const nextDigest = digest(serialized);
    const known = knownDigests.get(key(userId, serverName));
    if (known?.digest === nextDigest && Date.now() - known.savedAt < refreshAfterMs) {
      return;
    }
    const target = query(userId, serverName);
    await deps.deleteTokens(target);
    await deps.createToken({
      userId,
      type: MCP_TOOL_SNAPSHOT_TOKEN_TYPE,
      identifier: target.identifier as string,
      token: serialized,
      expiresIn: ttlSeconds,
    });
    knownDigests.set(key(userId, serverName), { digest: nextDigest, savedAt: Date.now() });
  }

  return { load, save, remove };
}

/**
 * Loads an OAuth server's stored tool definitions so a turn can expose them without
 * connecting. `null` means the caller should use its regular discovery, which may prompt
 * once; that successful discovery stores the snapshot later turns rely on.
 */
export async function loadDeferredMCPServerTools({
  userId,
  serverName,
  snapshots,
}: {
  userId: string;
  serverName: string;
  snapshots: MCPToolSnapshots;
}): Promise<LCAvailableTools | null> {
  try {
    return await snapshots.load(userId, serverName);
  } catch (error) {
    logger.warn('[MCP Tool Snapshot] Snapshot unavailable; using regular discovery', {
      serverName,
      error: (error as Error)?.message,
    });
    return null;
  }
}
