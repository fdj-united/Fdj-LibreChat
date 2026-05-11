import crypto from 'node:crypto';
import { logger } from '@librechat/data-schemas';

export type ConfirmationDecision = 'accept' | 'cancel' | 'timeout';

export interface ConfirmationOutcome {
  decision: ConfirmationDecision;
}

interface PendingConfirmation {
  userId: string;
  resolve: (outcome: ConfirmationOutcome) => void;
  timer: NodeJS.Timeout;
}

export interface IConfirmationStore {
  register(userId: string, ttlMs: number): {
    confirmationId: string;
    waitForDecision: Promise<ConfirmationOutcome>;
  };
  resolve(
    confirmationId: string,
    userId: string,
    decision: 'accept' | 'cancel',
  ): { ok: true } | { ok: false; reason: 'not_found' | 'forbidden' };
  has(confirmationId: string): boolean;
  size(): number;
}

/**
 * In-memory store for pending MCP tool-call confirmations.
 *
 * Each entry holds a deferred promise that the wrapper code awaits while the
 * user reviews a "confirmationRequired" envelope. The deferred is resolved
 * when (a) the originating user POSTs to /api/mcp/confirm/:id, or (b) the TTL
 * elapses. A non-originating userId calling resolve() is rejected so that one
 * user cannot release another's pending action.
 *
 * Single-process v1. The IConfirmationStore interface allows swapping in a
 * Redis-backed implementation when multi-replica is required — note that a
 * Redis variant must also relocate the wait-loop, since pub/sub crosses
 * processes and Promises do not.
 */
export class ConfirmationStore implements IConfirmationStore {
  private pending = new Map<string, PendingConfirmation>();

  register(
    userId: string,
    ttlMs: number,
  ): { confirmationId: string; waitForDecision: Promise<ConfirmationOutcome> } {
    if (!userId) {
      throw new Error('ConfirmationStore.register requires a userId');
    }
    if (!Number.isFinite(ttlMs) || ttlMs <= 0) {
      throw new Error('ConfirmationStore.register requires a positive ttlMs');
    }

    const confirmationId = crypto.randomUUID();

    const waitForDecision = new Promise<ConfirmationOutcome>((resolvePromise) => {
      const timer = setTimeout(() => {
        const entry = this.pending.get(confirmationId);
        if (!entry) return;
        this.pending.delete(confirmationId);
        logger.debug(
          `[ConfirmationStore] Confirmation ${confirmationId} timed out for user ${userId}`,
        );
        entry.resolve({ decision: 'timeout' });
      }, ttlMs);
      // Don't keep the event loop alive solely on a pending confirmation timer.
      if (typeof timer.unref === 'function') timer.unref();

      this.pending.set(confirmationId, {
        userId,
        resolve: resolvePromise,
        timer,
      });
    });

    return { confirmationId, waitForDecision };
  }

  resolve(
    confirmationId: string,
    userId: string,
    decision: 'accept' | 'cancel',
  ): { ok: true } | { ok: false; reason: 'not_found' | 'forbidden' } {
    const entry = this.pending.get(confirmationId);
    if (!entry) {
      return { ok: false, reason: 'not_found' };
    }
    if (entry.userId !== userId) {
      logger.warn(
        `[ConfirmationStore] User ${userId} attempted to resolve confirmation ${confirmationId} owned by ${entry.userId}`,
      );
      return { ok: false, reason: 'forbidden' };
    }
    clearTimeout(entry.timer);
    this.pending.delete(confirmationId);
    entry.resolve({ decision });
    return { ok: true };
  }

  has(confirmationId: string): boolean {
    return this.pending.has(confirmationId);
  }

  size(): number {
    return this.pending.size;
  }
}

let singleton: ConfirmationStore | null = null;

export function getConfirmationStore(): ConfirmationStore {
  if (!singleton) {
    singleton = new ConfirmationStore();
  }
  return singleton;
}

/** Test-only — resets the singleton. Do not call from production code. */
export function __resetConfirmationStoreForTests(): void {
  singleton = null;
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
export function parseConfirmationEnvelope(
  result: unknown,
): ConfirmationEnvelope | null {
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
const KNOWN_IMPORTANCES: ReadonlySet<PresentationImportance> = new Set([
  'primary',
  'detail',
]);

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
