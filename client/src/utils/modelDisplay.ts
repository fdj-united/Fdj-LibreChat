const CLAUDE_FAMILY: Record<string, string> = {
  opus: 'Opus',
  sonnet: 'Sonnet',
  haiku: 'Haiku',
  fable: 'Fable',
};

/** `('4', '5')` → `4.5`; `('4')` → `4`. */
const formatVersion = (major: string, minor?: string): string =>
  minor != null ? `${major}.${minor}` : major;

/**
 * Maps a model id/ARN to a friendly display name for the agent builder, so bedrock
 * inference-profile ARNs and raw ids don't leak into the UI. Handles both Claude
 * naming schemes:
 *   - family-first (Claude 4+):   `claude-sonnet-4-5`, `claude-opus-4-20250514`
 *   - version-first (Claude 3.x): `claude-3-7-sonnet-latest`, `claude-3-5-haiku-...`
 *
 * The minor version is limited to 1–2 digits and must not be a date suffix, so
 * `claude-sonnet-4-20250514` → "Claude Sonnet 4" (not "4.20250514") while
 * `claude-sonnet-4-5-20250929` → "Claude Sonnet 4.5". Falls back to the raw id.
 */
export function getModelDisplayName(modelId: string): string {
  if (!modelId) {
    return modelId;
  }
  const id = modelId.toLowerCase();

  // Family-first: claude-<family>-<major>[-<minor>]. The minor is 1–2 digits and the
  // negative lookahead rejects a date suffix (e.g. `-20250514`, `-20250929`).
  const familyFirst = id.match(/claude-(opus|sonnet|haiku|fable)-(\d+)(?:-(\d{1,2})(?!\d))?/);
  if (familyFirst) {
    return `Claude ${CLAUDE_FAMILY[familyFirst[1]]} ${formatVersion(familyFirst[2], familyFirst[3])}`;
  }

  // Version-first: claude-<major>[-<minor>]-<family> (the family word ends the version,
  // so any trailing date/`-latest` is naturally excluded).
  const versionFirst = id.match(/claude-(\d+)(?:-(\d{1,2}))?-(opus|sonnet|haiku|fable)/);
  if (versionFirst) {
    return `Claude ${CLAUDE_FAMILY[versionFirst[3]]} ${formatVersion(versionFirst[1], versionFirst[2])}`;
  }

  // GPT family — order matters (mini before 4o).
  if (id.includes('gpt-4o-mini')) {
    return 'GPT-4o mini';
  }
  if (id.includes('gpt-4o') || id.includes('chatgpt-4o')) {
    return 'GPT-4o';
  }
  if (id.includes('gpt-5-nano')) {
    return 'GPT-5 nano';
  }
  const gpt5 = id.match(/gpt-5[.-](\d+)/);
  if (gpt5) {
    return `GPT-5.${gpt5[1]}`;
  }
  if (id.includes('gpt-5')) {
    return 'GPT-5';
  }

  // Qwen 3 32B (e.g. `qwen.qwen3-32b-v1:0`).
  if (/qwen3?.*32b/.test(id)) {
    return 'Qwen 3.32B';
  }

  return modelId;
}
