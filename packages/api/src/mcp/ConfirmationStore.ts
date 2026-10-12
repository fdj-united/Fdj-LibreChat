import crypto from 'node:crypto';
import { logger } from '@librechat/data-schemas';
import type { Redis, Cluster } from 'ioredis';
import { cacheConfig } from '~/cache/cacheConfig';
import { ioredisClient } from '~/cache/redisClients';

export type ConfirmationDecision = 'accept' | 'cancel' | 'timeout';

export type UserDecision = Exclude<ConfirmationDecision, 'timeout'>;

export interface ConfirmationOutcome {
  decision: ConfirmationDecision;
}

export type ConfirmationResolution =
  | { ok: true }
  | { ok: false; reason: 'not_found' | 'forbidden' };

export interface ConfirmationRegistration {
  confirmationId: string;
  waitForDecision: Promise<ConfirmationOutcome>;
}

interface PendingConfirmation {
  userId: string;
  resolve: (outcome: ConfirmationOutcome) => void;
  timer: NodeJS.Timeout;
  /** After this, the shared record has expired and its decision can no longer be recovered. */
  retainUntil: number;
}

export interface ConfirmationStoreOptions {
  /** How often the registering replica re-reads shared decisions, covering missed notifications. */
  pollIntervalMs?: number;
}

export interface IConfirmationStore {
  register(userId: string, ttlMs: number): Promise<ConfirmationRegistration>;
  resolve(
    confirmationId: string,
    userId: string,
    decision: UserDecision,
  ): Promise<ConfirmationResolution>;
  has(confirmationId: string): boolean;
  size(): number;
}

/**
 * Shares pending confirmations between replicas. The awaiting promise can only
 * live in the replica running the agent, so every decision — wherever it is
 * posted — is recorded in a shared record that the registering replica reads.
 */
export interface ConfirmationRelay {
  /** Creates the shared record; it outlives `ttlMs` so a last-moment decision stays readable. */
  claim(confirmationId: string, userId: string, ttlMs: number): Promise<void>;
  /**
   * Atomically records the first decision for a confirmation owned by `userId`.
   * User decisions are rejected once `ttlMs` has elapsed; only the timeout may be recorded then.
   */
  decide(
    confirmationId: string,
    userId: string,
    decision: ConfirmationDecision,
  ): Promise<ConfirmationResolution>;
  read(confirmationId: string): Promise<ConfirmationDecision | null>;
  /** Best-effort wake-up for the registering replica; the recorded decision is the source of truth. */
  notify(confirmationId: string): Promise<void>;
  /** `onNotify` is called without an id after a reconnect, when notifications may have been missed. */
  listen(onNotify: (confirmationId?: string) => void): Promise<void>;
  discard(confirmationId: string): Promise<void>;
  close(): Promise<void>;
}

/** Keeps a decision readable after the deadline, while the registering replica settles it. */
const DECISION_RETENTION_MS = 30_000;

const DEFAULT_POLL_INTERVAL_MS = 2_000;

const EXPIRY_RETRY_MS = 1_000;

const CLAIM_CONFIRMATION = `
redis.call('HSET', KEYS[1], 'owner', ARGV[1])
redis.call('PEXPIRE', KEYS[1], ARGV[2])
return 1
`;

/**
 * Returns 1 when recorded, 0 when missing, past its deadline or already decided,
 * -1 when owned by another user. The deadline is derived from the record's own
 * TTL so it follows the Redis clock rather than any replica's.
 */
const DECIDE_CONFIRMATION = `
local owner = redis.call('HGET', KEYS[1], 'owner')
if not owner then return 0 end
if owner ~= ARGV[1] then return -1 end
if ARGV[2] ~= 'timeout' and redis.call('PTTL', KEYS[1]) <= tonumber(ARGV[3]) then return 0 end
return redis.call('HSETNX', KEYS[1], 'decision', ARGV[2])
`;

function isConfirmationDecision(value: string | null): value is ConfirmationDecision {
  return value === 'accept' || value === 'cancel' || value === 'timeout';
}

/**
 * Redis-backed relay. Records are hashes (namespaced by the client's `keyPrefix`);
 * pub/sub channels are not prefixed by ioredis, so the channel name carries the
 * deployment prefix explicitly.
 */
export class RedisConfirmationRelay implements ConfirmationRelay {
  private readonly channel: string;
  private subscriber: Redis | Cluster | null = null;

  constructor(
    private readonly client: Redis | Cluster,
    channelPrefix: string = `${cacheConfig.REDIS_KEY_PREFIX}${cacheConfig.GLOBAL_PREFIX_SEPARATOR}`,
  ) {
    this.channel = `${channelPrefix}mcp_confirmations`;
  }

  private recordKey(confirmationId: string): string {
    return `mcp_confirmation:${confirmationId}`;
  }

  async claim(confirmationId: string, userId: string, ttlMs: number): Promise<void> {
    await this.client.eval(
      CLAIM_CONFIRMATION,
      1,
      this.recordKey(confirmationId),
      userId,
      ttlMs + DECISION_RETENTION_MS,
    );
  }

  async decide(
    confirmationId: string,
    userId: string,
    decision: ConfirmationDecision,
  ): Promise<ConfirmationResolution> {
    const recorded = Number(
      await this.client.eval(
        DECIDE_CONFIRMATION,
        1,
        this.recordKey(confirmationId),
        userId,
        decision,
        DECISION_RETENTION_MS,
      ),
    );
    if (recorded === -1) {
      logger.warn(
        `[ConfirmationStore] User ${userId} attempted to resolve confirmation ${confirmationId} owned by another user`,
      );
      return { ok: false, reason: 'forbidden' };
    }
    return recorded === 1 ? { ok: true } : { ok: false, reason: 'not_found' };
  }

  async read(confirmationId: string): Promise<ConfirmationDecision | null> {
    const decision = await this.client.hget(this.recordKey(confirmationId), 'decision');
    return isConfirmationDecision(decision) ? decision : null;
  }

  async notify(confirmationId: string): Promise<void> {
    await this.client.publish(this.channel, confirmationId);
  }

  async listen(onNotify: (confirmationId?: string) => void): Promise<void> {
    const subscriber = this.client.duplicate();
    subscriber.on('message', (channel: string, message: string) => {
      if (channel === this.channel) onNotify(message);
    });
    subscriber.on('ready', () => onNotify());
    try {
      await subscriber.subscribe(this.channel);
    } catch (error) {
      subscriber.disconnect();
      throw error;
    }
    this.subscriber = subscriber;
  }

  async discard(confirmationId: string): Promise<void> {
    await this.client.del(this.recordKey(confirmationId));
  }

  async close(): Promise<void> {
    await this.subscriber?.quit();
    this.subscriber = null;
  }
}

/**
 * Store for pending MCP tool-call confirmations.
 *
 * Each entry holds a deferred promise that the wrapper code awaits while the
 * user reviews a "confirmationRequired" envelope. The deferred is resolved
 * when (a) the originating user POSTs to /api/mcp/confirm/:id, or (b) the TTL
 * elapses. A non-originating userId calling resolve() is rejected so that one
 * user cannot release another's pending action.
 *
 * Deferreds always live in the replica that registered them. With a relay,
 * every decision — a click on any replica, an abort, or the timeout — is
 * arbitrated by the shared record, so only the first one is acknowledged, and
 * the registering replica settles with whatever was recorded. There is no
 * local fallback: a confirmation that cannot be shared is never registered.
 */
export class ConfirmationStore implements IConfirmationStore {
  private pending = new Map<string, PendingConfirmation>();
  private listening: Promise<void> | null = null;
  private poller: NodeJS.Timeout | null = null;

  private readonly relay: ConfirmationRelay | undefined;
  private readonly pollIntervalMs: number;

  constructor(relay?: ConfirmationRelay, options: ConfirmationStoreOptions = {}) {
    this.relay = relay;
    this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  }

  /**
   * The TTL starts once the confirmation is shared, so the caller's deadline
   * matches this store's. Rejects when the confirmation could not be shared;
   * the caller must then treat the action as not confirmed.
   */
  async register(userId: string, ttlMs: number): Promise<ConfirmationRegistration> {
    if (!userId) {
      throw new Error('ConfirmationStore.register requires a userId');
    }
    if (!Number.isFinite(ttlMs) || ttlMs <= 0) {
      throw new Error('ConfirmationStore.register requires a positive ttlMs');
    }

    const confirmationId = crypto.randomUUID();
    await this.share(confirmationId, userId, ttlMs);

    const waitForDecision = new Promise<ConfirmationOutcome>((resolvePromise) => {
      this.pending.set(confirmationId, {
        userId,
        resolve: resolvePromise,
        timer: this.schedule(() => this.expire(confirmationId), ttlMs),
        retainUntil: Date.now() + ttlMs + DECISION_RETENTION_MS,
      });
    });

    if (this.relay) this.startPolling();
    return { confirmationId, waitForDecision };
  }

  async resolve(
    confirmationId: string,
    userId: string,
    decision: UserDecision,
  ): Promise<ConfirmationResolution> {
    const entry = this.pending.get(confirmationId);
    if (entry && entry.userId !== userId) {
      logger.warn(
        `[ConfirmationStore] User ${userId} attempted to resolve confirmation ${confirmationId} owned by ${entry.userId}`,
      );
      return { ok: false, reason: 'forbidden' };
    }
    if (!this.relay) {
      if (!entry) return { ok: false, reason: 'not_found' };
      this.settle(confirmationId, decision);
      return { ok: true };
    }

    const result = await this.relay.decide(confirmationId, userId, decision);
    if (!result.ok) {
      if (entry) this.collect(confirmationId);
      return result;
    }
    if (this.pending.has(confirmationId)) {
      this.settle(confirmationId, decision);
      return result;
    }
    await this.relay.notify(confirmationId).catch((error) => {
      logger.warn(
        `[ConfirmationStore] Failed to notify replicas about confirmation ${confirmationId}; relying on polling`,
        error,
      );
    });
    return result;
  }

  has(confirmationId: string): boolean {
    return this.pending.has(confirmationId);
  }

  size(): number {
    return this.pending.size;
  }

  async close(): Promise<void> {
    this.stopPolling();
    this.listening = null;
    await this.relay?.close();
  }

  /**
   * Notifications only shorten the delay before a remote decision is seen, so a
   * subscription failure is tolerated; a failed claim is not, because Redis may
   * have applied it even though the reply was lost.
   */
  private async share(confirmationId: string, userId: string, ttlMs: number): Promise<void> {
    if (!this.relay) return;
    await this.ensureListening(this.relay).catch((error) => {
      logger.warn(
        '[ConfirmationStore] Could not subscribe to confirmation notifications; relying on polling',
        error,
      );
    });
    await this.relay.claim(confirmationId, userId, ttlMs);
  }

  private schedule(task: () => Promise<void>, delayMs: number): NodeJS.Timeout {
    const timer = setTimeout(() => void task(), delayMs);
    // Don't keep the event loop alive solely on a pending confirmation timer.
    if (typeof timer.unref === 'function') timer.unref();
    return timer;
  }

  private async ensureListening(relay: ConfirmationRelay): Promise<void> {
    this.listening ??= relay.listen(this.onNotify).catch((error) => {
      this.listening = null;
      throw error;
    });
    await this.listening;
  }

  private onNotify = (confirmationId?: string): void => {
    if (!confirmationId) {
      this.collectAll();
      return;
    }
    if (this.pending.has(confirmationId)) this.collect(confirmationId);
  };

  /**
   * A decision recorded before the deadline wins over the timeout. While the
   * shared record cannot be reached its contents are unknown, so the entry stays
   * pending and is retried until the record itself would have expired.
   */
  private async expire(confirmationId: string): Promise<void> {
    const entry = this.pending.get(confirmationId);
    if (!entry) return;
    logger.debug(
      `[ConfirmationStore] Confirmation ${confirmationId} timed out for user ${entry.userId}`,
    );
    if (!this.relay) {
      this.settle(confirmationId, 'timeout');
      return;
    }
    try {
      const result = await this.relay.decide(confirmationId, entry.userId, 'timeout');
      const recorded = result.ok ? 'timeout' : await this.relay.read(confirmationId);
      this.settle(confirmationId, recorded ?? 'timeout');
    } catch (error) {
      if (Date.now() >= entry.retainUntil) {
        logger.error(
          `[ConfirmationStore] Shared record for confirmation ${confirmationId} stayed unreachable until it expired; settling as timeout`,
          error,
        );
        this.settle(confirmationId, 'timeout', false);
        return;
      }
      logger.warn(
        `[ConfirmationStore] Could not arbitrate timeout for confirmation ${confirmationId}; retrying`,
        error,
      );
      entry.timer = this.schedule(() => this.expire(confirmationId), EXPIRY_RETRY_MS);
    }
  }

  private collect(confirmationId: string): void {
    this.relay
      ?.read(confirmationId)
      .then((decision) => {
        if (decision) this.settle(confirmationId, decision);
      })
      .catch((error) => {
        logger.warn(`[ConfirmationStore] Failed to read confirmation ${confirmationId}`, error);
      });
  }

  private collectAll(): void {
    for (const confirmationId of this.pending.keys()) {
      this.collect(confirmationId);
    }
  }

  private startPolling(): void {
    if (this.poller) return;
    this.poller = setInterval(() => this.collectAll(), this.pollIntervalMs);
    if (typeof this.poller.unref === 'function') this.poller.unref();
  }

  private stopPolling(): void {
    if (!this.poller) return;
    clearInterval(this.poller);
    this.poller = null;
  }

  /** `discard` must stay false when the shared record's contents are unknown. */
  private settle(confirmationId: string, decision: ConfirmationDecision, discard = true): void {
    const entry = this.pending.get(confirmationId);
    if (!entry) return;
    clearTimeout(entry.timer);
    this.pending.delete(confirmationId);
    if (this.pending.size === 0) this.stopPolling();
    entry.resolve({ decision });
    if (!discard) return;
    this.relay?.discard(confirmationId).catch((error) => {
      logger.warn(`[ConfirmationStore] Failed to discard confirmation ${confirmationId}`, error);
    });
  }
}

function createConfirmationRelay(): ConfirmationRelay | undefined {
  if (!cacheConfig.USE_REDIS || !ioredisClient) return undefined;
  return new RedisConfirmationRelay(ioredisClient);
}

let singleton: ConfirmationStore | null = null;

export function getConfirmationStore(): ConfirmationStore {
  if (!singleton) {
    singleton = new ConfirmationStore(createConfirmationRelay());
  }
  return singleton;
}

/** Test-only — resets the singleton. Do not call from production code. */
export async function __resetConfirmationStoreForTests(): Promise<void> {
  const store = singleton;
  singleton = null;
  await store?.close();
}

export const CONFIRMATION_ENVELOPE_INSTRUCTION_PREFIX = 'STOP. Do NOT';

/**
 * Hint format for a single presentation field; matches the gateway's
 * `PresentationFormat` enum. Unknown values fall back to "text" client-side.
 */
export type PresentationFormat = 'text' | 'code' | 'json' | 'markdown';

/** Whether to show in the at-a-glance summary or under "show details". */
export type PresentationImportance = 'primary' | 'detail';

export interface PresentationField {
  label: string;
  value: unknown;
  format?: PresentationFormat;
  importance?: PresentationImportance;
}

/**
 * Optional structured rendering hints attached to the confirmation envelope by
 * the gateway. When absent, the client falls back to parsing the raw `preview`
 * string. Loosely modelled on MCP elicitation
 * (https://modelcontextprotocol.io/specification/2025-06-18/client/elicitation):
 * the server describes what to show, the client renders it.
 */
export interface ConfirmationPresentation {
  title?: string;
  summary?: string;
  fields: PresentationField[];
}

export interface ConfirmationEnvelope {
  confirmationRequired: true;
  preview: string;
  expiresInSeconds: number;
  instruction?: string;
  presentation?: ConfirmationPresentation;
}

/**
 * Extracts the first text block from a FormattedContentResult and tries to
 * parse it as a confirmation envelope. Returns null if the result is not an
 * envelope.
 */
export function parseConfirmationEnvelope(result: unknown): ConfirmationEnvelope | null {
  if (!Array.isArray(result) || result.length === 0) return null;
  const [content] = result as [unknown, unknown];
  let text: string | null = null;
  if (typeof content === 'string') {
    text = content;
  } else if (Array.isArray(content) && content.length > 0) {
    const first = content[0] as { type?: unknown; text?: unknown };
    if (first && first.type === 'text' && typeof first.text === 'string') {
      text = first.text;
    }
  }
  if (!text) return null;
  const trimmed = text.trim();
  if (!trimmed.startsWith('{')) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (
    parsed &&
    typeof parsed === 'object' &&
    (parsed as { confirmationRequired?: unknown }).confirmationRequired === true
  ) {
    const env = parsed as Record<string, unknown>;
    const preview = typeof env.preview === 'string' ? env.preview : '';
    const expiresInSeconds =
      typeof env.expiresInSeconds === 'number' && env.expiresInSeconds > 0
        ? env.expiresInSeconds
        : 120;
    const instruction = typeof env.instruction === 'string' ? env.instruction : undefined;
    const presentation = normalizePresentation(env.presentation);
    return {
      confirmationRequired: true,
      preview,
      expiresInSeconds,
      instruction,
      ...(presentation ? { presentation } : {}),
    };
  }
  return null;
}

const KNOWN_FORMATS: ReadonlySet<PresentationFormat> = new Set([
  'text',
  'code',
  'json',
  'markdown',
]);
const KNOWN_IMPORTANCES: ReadonlySet<PresentationImportance> = new Set(['primary', 'detail']);

/**
 * Coerce an arbitrary `presentation` value into our typed shape. Defensive
 * against gateway-side schema drift: any field that doesn't look right is
 * dropped rather than throwing, so we degrade to the raw `preview` cleanly.
 */
function normalizePresentation(value: unknown): ConfirmationPresentation | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const obj = value as Record<string, unknown>;
  const rawFields = obj.fields;
  if (!Array.isArray(rawFields)) return undefined;
  const fields: PresentationField[] = [];
  for (const raw of rawFields) {
    if (!raw || typeof raw !== 'object') continue;
    const f = raw as Record<string, unknown>;
    if (typeof f.label !== 'string' || !('value' in f)) continue;
    const format =
      typeof f.format === 'string' && KNOWN_FORMATS.has(f.format as PresentationFormat)
        ? (f.format as PresentationFormat)
        : undefined;
    const importance =
      typeof f.importance === 'string' &&
      KNOWN_IMPORTANCES.has(f.importance as PresentationImportance)
        ? (f.importance as PresentationImportance)
        : undefined;
    fields.push({
      label: f.label,
      value: f.value,
      ...(format ? { format } : {}),
      ...(importance ? { importance } : {}),
    });
  }
  if (fields.length === 0) return undefined;
  return {
    title: typeof obj.title === 'string' ? obj.title : undefined,
    summary: typeof obj.summary === 'string' ? obj.summary : undefined,
    fields,
  };
}
