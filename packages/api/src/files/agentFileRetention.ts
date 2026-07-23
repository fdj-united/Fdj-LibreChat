/**
 * Per-agent, disk-only file retention.
 *
 * For each configured agent, user-uploaded local files older than the agent's
 * `retentionHours` have their physical file unlinked from the local `uploads`
 * directory. Nothing else is touched:
 *   - the file's database record is preserved (so downstream analytics that read
 *     `messages` / `transactions` — never `files` — are unaffected);
 *   - RAG vector embeddings, agent skill / code-env files, and image uploads are
 *     never candidates (the caller's `getExpiredAgentUploads` scopes to a single
 *     agent's `message_attachment` uploads under `/uploads/...` only).
 *
 * This is intentionally independent of the conversation `expiredAt` sweep
 * (`sweepExpiredFiles`): that one deletes both storage and DB record for
 * retention-expired conversations; this one only unlinks physical files and never
 * deletes a record, so the two never operate on the same data.
 *
 * All I/O is injected so the logic is unit-testable in isolation.
 */

const DEFAULT_INTERVAL_MS = 60 * 60 * 1000; // hourly
const HOUR_MS = 60 * 60 * 1000;

export interface AgentFileRetentionRule {
  agentId: string;
  retentionHours: number;
}

/** A physical file eligible for disk-only deletion. */
export interface RetentionCandidate {
  file_id: string;
  /** Stored filepath, e.g. `/uploads/<userId>/<fileId>__<name>`. */
  filepath: string;
  /** Owning user id (used to resolve and validate the physical path). */
  user: string;
}

export type DiskDeleteOutcome = 'deleted' | 'missing';

export interface AgentFileRetentionLogger {
  info: (message: string, ...meta: unknown[]) => void;
  warn: (message: string, ...meta: unknown[]) => void;
  error: (message: string, ...meta: unknown[]) => void;
}

export interface AgentFileRetentionDeps {
  /**
   * Return the local `message_attachment` uploads for `agentId` whose upload time
   * is at or before `cutoff`. Must NOT return images, RAG, skill/code-env, or
   * non-local files. A thrown error isolates that one agent (its files are left
   * untouched) — never deletes on error.
   */
  getExpiredAgentUploads: (agentId: string, cutoff: Date) => Promise<RetentionCandidate[]>;
  /**
   * Unlink the physical file for `candidate`. Returns `'deleted'` when a file was
   * removed and `'missing'` when it was already gone (idempotent). Must throw only
   * on genuine, unexpected errors. Must never touch the database.
   */
  deleteDiskFile: (candidate: RetentionCandidate) => Promise<DiskDeleteOutcome>;
  logger: AgentFileRetentionLogger;
  /** Injectable clock for tests. Defaults to `Date.now`. */
  now?: () => number;
}

export interface AgentFileRetentionOptions {
  rules: AgentFileRetentionRule[];
  /** When true, log candidates without unlinking anything. */
  dryRun?: boolean;
}

export interface AgentFileRetentionResult {
  scanned: number;
  deleted: number;
  missing: number;
  failed: number;
  /** Agents whose lookup threw and were skipped entirely (fail-closed). */
  skippedAgents: number;
}

/** A rule is usable only with a non-empty agentId and a positive retention. */
function isValidRule(rule: AgentFileRetentionRule | null | undefined): rule is AgentFileRetentionRule {
  return (
    !!rule &&
    typeof rule.agentId === 'string' &&
    rule.agentId.length > 0 &&
    typeof rule.retentionHours === 'number' &&
    Number.isFinite(rule.retentionHours) &&
    rule.retentionHours > 0
  );
}

/**
 * Run one disk-only retention pass over all configured agents. Never throws:
 * per-agent lookup failures are isolated and counted, so one bad agent can never
 * abort the sweep or cause deletions elsewhere.
 */
export async function sweepAgentFiles(
  options: AgentFileRetentionOptions,
  deps: AgentFileRetentionDeps,
): Promise<AgentFileRetentionResult> {
  const result: AgentFileRetentionResult = {
    scanned: 0,
    deleted: 0,
    missing: 0,
    failed: 0,
    skippedAgents: 0,
  };

  const rules = (options?.rules ?? []).filter(isValidRule);
  if (rules.length === 0) {
    return result;
  }

  const nowMs = deps.now?.() ?? Date.now();
  const dryRun = options.dryRun === true;

  for (const rule of rules) {
    const cutoff = new Date(nowMs - rule.retentionHours * HOUR_MS);

    let candidates: RetentionCandidate[];
    try {
      candidates = (await deps.getExpiredAgentUploads(rule.agentId, cutoff)) ?? [];
    } catch (error) {
      // Fail-closed: if we cannot reliably identify this agent's files, delete
      // nothing for it this pass.
      result.skippedAgents += 1;
      deps.logger.error(
        `[agentFileRetention] Lookup failed for agent ${rule.agentId}; skipping (no deletions):`,
        error,
      );
      continue;
    }

    for (const candidate of candidates) {
      result.scanned += 1;

      if (dryRun) {
        deps.logger.info(
          `[agentFileRetention] (dry-run) would delete ${candidate.filepath} ` +
            `(agent ${rule.agentId}, file_id ${candidate.file_id})`,
        );
        continue;
      }

      try {
        const outcome = await deps.deleteDiskFile(candidate);
        if (outcome === 'deleted') {
          result.deleted += 1;
          deps.logger.info(
            `[agentFileRetention] Deleted disk file ${candidate.filepath} ` +
              `(agent ${rule.agentId}, file_id ${candidate.file_id})`,
          );
        } else {
          result.missing += 1;
        }
      } catch (error) {
        result.failed += 1;
        deps.logger.error(
          `[agentFileRetention] Failed to delete ${candidate.filepath} ` +
            `(agent ${rule.agentId}, file_id ${candidate.file_id}):`,
          error,
        );
      }
    }
  }

  const mode = dryRun ? ' (dry-run)' : '';
  deps.logger.info(
    `[agentFileRetention] Pass complete${mode}: scanned ${result.scanned}, ` +
      `deleted ${result.deleted}, missing ${result.missing}, failed ${result.failed}, ` +
      `skippedAgents ${result.skippedAgents}`,
  );
  return result;
}

export interface StartAgentFileRetentionDeps extends AgentFileRetentionDeps {
  sweepAgentFiles: (
    options: AgentFileRetentionOptions,
    deps: AgentFileRetentionDeps,
  ) => Promise<AgentFileRetentionResult>;
}

/**
 * Start the recurring disk-only retention sweep. Returns the interval handle, or
 * `null` when disabled (no valid rules, or `intervalMs === 0`). Guards against
 * overlapping runs and never lets a sweep error crash the process.
 */
export function startAgentFileRetentionSweep(
  options: (AgentFileRetentionOptions & { intervalMs?: number }) | undefined,
  deps: StartAgentFileRetentionDeps,
): NodeJS.Timeout | null {
  const rules = (options?.rules ?? []).filter(isValidRule);
  if (rules.length === 0) {
    deps.logger.info('[agentFileRetention] Disabled: no valid agent retention rules configured');
    return null;
  }

  const intervalMs = options?.intervalMs ?? DEFAULT_INTERVAL_MS;
  if (intervalMs === 0) {
    deps.logger.info('[agentFileRetention] Disabled by intervalMs=0');
    return null;
  }

  const sweepOptions: AgentFileRetentionOptions = { rules, dryRun: options?.dryRun };

  let isSweeping = false;
  const runSweep = async () => {
    if (isSweeping) {
      return;
    }
    isSweeping = true;
    try {
      await deps.sweepAgentFiles(sweepOptions, deps);
    } catch (error) {
      deps.logger.error('[agentFileRetention] Background sweep failed:', error);
    } finally {
      isSweeping = false;
    }
  };

  deps.logger.info(
    `[agentFileRetention] Enabled for ${rules.length} agent(s), interval ${intervalMs}ms` +
      (options?.dryRun ? ' (dry-run)' : ''),
  );
  void runSweep();
  const interval = setInterval(runSweep, intervalMs);
  interval.unref?.();
  return interval;
}
