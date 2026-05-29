---
name: update-librechat
description: Pull upstream danny-avila/LibreChat changes into the fdj-united fork using a two-phase workflow — sync main to a chosen upstream tag (or branch tip), then cut a NEW release branch (release/v<new>, e.g. release/v0.8.5) and replay the fork's patches onto it. The starting release branch is never modified — no force-push, ever. Triages conflicts per block, validates with Turborepo build. Per-merge fdj iterations are tracked as tags by /merge-feature; release branches are stable (Workflow Y).
---

# About

This fork (`fdj-united/Fdj-LibreChat`) treats release branches as **immutable per-upstream-version artifacts**: `release/v0.8.4` (or the legacy `release/v0.8.4-fdj11` if you're upgrading from an older naming convention) stays frozen at upstream v0.8.4. Upgrading to a newer upstream version means:

1. Sync `main` to the new upstream tag (or `upstream/main` tip).
2. Cut a NEW release branch (e.g. `release/v0.8.5`) from the synced `main`.
3. Cherry-pick the fdj-specific commits from the old release branch onto the new one.

The new branch name is just `release/v<new-version>` — no `-fdj<N>` suffix. The fdj counter lives in **tags** that `/merge-feature` creates per-merge (`v0.8.5-fdj1`, `v0.8.5-fdj2`, ...). Branch stable, tags accumulate (Workflow Y).

The old release branch is never touched. No force-pushes. The skill automates this two-phase flow.

Run `/update-librechat` in Claude Code.

## How it works

**Preflight**: requires a clean working tree (`git status --porcelain`). The `upstream` remote should already point at `https://github.com/danny-avila/LibreChat.git`; if missing, asks for the URL and adds it. Fetches branches and tags.

**Upstream reference selection**: asks whether to sync to a specific upstream release tag (recommended) or the tip of `upstream/main`. If tag, shows the most recent ~15 release tags so you can pick. The chosen ref (e.g. `v0.8.5` or `upstream/main`) is used for both phases.

**Workflow planning**: detects the starting branch.
- On `main` → **Phase 1 only** (just sync main).
- On `release/v<X.Y.Z>` or `release/v<X.Y.Z>-fdj<N>` (legacy) → **two-phase**: derives the previous upstream version from the branch name, proposes a new branch name `release/v<new>` (no fdj suffix), lists the fdj commits that will be replayed. You can override the new branch name.
- On any other branch → asks how to handle it.

**Phase 1 — Sync `main` (local only)**
1. Checkout `main`, ff-pull from `origin/main` (stop if main has diverged from its remote).
2. Dry-run merge to preview conflicts.
3. Merge the chosen upstream ref into `main`.
4. Triage any conflicts per block (see triage protocol).
5. Offer `npm install` if any manifest changed; run `npm run build:data-provider` + `npm run build`.
6. **Nothing is pushed yet** — all changes stay local until the final publish gate.

**Phase 2 — Cut new release branch + replay fdj patches (local only)** (skipped if started on `main`)
1. Compute the list of fdj commits to replay: `git log --no-merges --reverse $PREV_UPSTREAM_VERSION..$START_BRANCH`. Show the list and let you select all or a subset.
2. Create the new branch from the synced `main`: `git checkout -b release/v<new> main` (e.g. `release/v0.8.5`).
3. Cherry-pick the selected fdj commits one by one.
4. Triage conflicts per commit (see triage protocol).
5. Validate again (the patches themselves may change deps/types).
6. **Nothing is pushed yet** — see the publish gate below.

**Publish gate (final step before summary)**: shows everything that's about to be pushed (main old→new HEAD, new release branch + commit count), asks which branches to publish. Pushes `main` first, then the new release branch. If either push fails, surfaces the error and stops — no auto-rebase, no force-push. You can re-run this step or push manually after reconciling.

**Conflict resolution** (triage protocol, used in both phases): for every conflict block, classifies it as **trivial** (whitespace, import reorder, version bump, comment-only) or **non-trivial** (backend logic, MCP code, config, type/control-flow changes). Trivial blocks auto-resolve with a one-line note. Non-trivial blocks pause for you: shows the marker block with surrounding context + the proposed resolution + reasoning, and asks you to **Apply / Keep fork only / Keep upstream only / Skip (resolve manually)**. Lockfile conflicts regenerate via `npm install`, never hand-edit. Default to asking when classification confidence is below ~95%.

**Static require sweep** (Step 7b): after the build passes, scans fork-touched `api/**/*.js` files for `require('~/...')` and `import ... from '~/...'` paths whose target no longer exists. Catches the class of regression where upstream moves a file (e.g. `api/models/spendTokens.js` → `packages/data-schemas/`) and your fork patch still references the old path — these resolve at git-merge time, pass `npm run build`, and crash only at backend startup. Best-effort: doesn't catch TS path mismatches, dynamic requires, or wrong named exports. Not a replacement for smoke-testing.

**Breaking-change scan**: greps Conventional Commits markers (`feat!:`, `fix!:`, `BREAKING CHANGE:`) in the merged commit log, plus any `CHANGELOG.md` changes, and surfaces hits before you push.

**Summary**: shows new HEAD of main, new release branch name + replayed commit count, backup tag for main rollback, conflicts resolved, MCP hotspot files touched, and pre-push smoke-test recommendations.

## Rollback

- **Main**: backup tag `pre-update-main-<hash>-<timestamp>` is printed at the end. To roll back: `git reset --hard <backup-tag>` while on `main`.
- **New release branch**: just delete it — it was never on the original. `git branch -D release/v<new>`. If you already pushed it, also `git push origin --delete release/v<new>`.
- **Starting release branch**: **never modified by this skill**. No rollback needed.

## Token usage

Only opens files with actual conflicts. Uses `git log`, `git diff`, and `git status` for everything else. Does not scan or refactor unrelated code.

---

# Goal
Bring upstream `danny-avila/LibreChat` changes into the fork by keeping `main` as a clean upstream mirror and cutting new immutable release branches per upstream version. The starting release branch is never modified.

# Operating principles
- Never proceed with a dirty working tree.
- Always create rollback points before modifying `main`.
- Never modify the starting release branch. Phase 2 creates a NEW branch.
- Prefer git-native operations (fetch, merge, cherry-pick). Do not manually rewrite files except conflict markers.
- Never force-push, never rewrite shared history, never `--no-verify` without explicit user say-so.
- Ask before any `git push`. `main` is shared.
- Keep token usage low: rely on `git status`, `git log`, `git diff`, and open only conflicted files.

# Step 0: Preflight (stop early if unsafe)
Run:
- `git status --porcelain`

If output is non-empty:
- Tell the user to commit or stash first, then stop.

Capture the starting branch immediately (before any checkout in later steps):
- `START_BRANCH=$(git rev-parse --abbrev-ref HEAD)`

Confirm remotes:
- `git remote -v`

If `upstream` is missing:
- Ask the user for the upstream repo URL (default: `https://github.com/danny-avila/LibreChat.git`).
- Add it: `git remote add upstream <user-provided-url>`

Determine the upstream branch name:
- `git branch -r | grep upstream/`
- If `upstream/main` exists, use `main`.
- If only `upstream/master` exists, use `master`.
- Otherwise, ask the user which branch to use.
- Store as `UPSTREAM_BRANCH`.

Fetch branches and tags from both remotes (we'll need `origin/main` later too):
- `git fetch upstream --prune --tags`
- `git fetch origin --prune`

## Step 0.5: Pick the upstream reference (tag vs branch tip)

Use AskUserQuestion:
- Option A (Recommended): **Sync to a specific upstream release tag** — controlled, matches the `release/v<version>` naming convention.
- Option B: **Sync to `upstream/$UPSTREAM_BRANCH` tip** — latest unreleased upstream; useful for unreleased fixes.
- Option C: **Abort** — stop here.

If Option B: set `UPSTREAM_REF="upstream/$UPSTREAM_BRANCH"`. Also set `UPSTREAM_VERSION=""` (no version-based branch name available — we'll ask in Step 1).

If Option C: stop. (No backup created since nothing changed.)

If Option A:
- List recent upstream release tags with date and subject:
  ```
  for t in $(git tag --list --sort=-v:refname 'v*' | head -15); do
    printf '%s  %s  %s\n' "$t" "$(git log -1 --format=%ad --date=short "$t")" "$(git log -1 --format=%s "$t" | cut -c1-70)"
  done
  ```
  If `v*` returns nothing, drop the prefix filter.
- If `START_BRANCH` matches `^release/v[0-9]+\.[0-9]+\.[0-9]+(-fdj[0-9]+)?$`, parse out the version (e.g. `v0.8.4`) and label it "currently on" in the list.
- Ask the user to type the tag they want. Validate: `git rev-parse --verify "refs/tags/$TAG"`. If invalid, re-show the list and re-prompt.
- If chosen tag is older than the parsed current version, warn and require explicit confirmation.
- Set `UPSTREAM_REF=$TAG` and `UPSTREAM_VERSION=$TAG` (e.g. `v0.8.5`).

For the rest of the skill, all git operations use `$UPSTREAM_REF` (either a tag like `v0.8.5` or a branch ref like `upstream/main`).

# Step 1: Plan the workflow

Classify the starting branch and pick a workflow.

**If `START_BRANCH == main`** (or `master`):
- Set `WORKFLOW=phase1-only`.
- Inform the user: "You're on `main`. I'll sync it to `$UPSTREAM_REF`. No release branch will be cut — Phase 2 is skipped. If you want a new release branch afterwards, re-run the skill from one of your release branches."
- Proceed to Step 2.

**If `START_BRANCH` matches `^release/v[0-9]+\.[0-9]+\.[0-9]+(-fdj[0-9]+)?$`** (accepts both the new naming `release/v0.8.4` and the legacy `release/v0.8.4-fdj11`):
- Set `WORKFLOW=two-phase`.
- Parse the previous upstream version: regex capture `v[0-9]+\.[0-9]+\.[0-9]+` from `$START_BRANCH`. Store as `PREV_UPSTREAM_VERSION` (e.g. `v0.8.4`).
- Validate it exists as a tag: `git rev-parse --verify "refs/tags/$PREV_UPSTREAM_VERSION"`. If missing, ask the user which tag the starting branch was based on and use their answer.
- Compute the proposed new branch name (Workflow Y: no `-fdj<N>` suffix — that lives in tags created by `/merge-feature`):
  - If `$UPSTREAM_VERSION` is set (tag was chosen in Step 0.5): `NEW_BRANCH="release/$UPSTREAM_VERSION"` (e.g. `release/v0.8.5`).
  - If `$UPSTREAM_VERSION` is empty (branch-tip mode): ask the user for the new branch name. Suggest `release/main-<date>` as a fallback default.
- Check the proposed branch name doesn't collide, locally OR on origin (we never force-push, so an existing remote ref would block the publish step):
  - `git rev-parse --verify "refs/heads/$NEW_BRANCH" 2>/dev/null` — local check
  - `git ls-remote --exit-code --heads origin "$NEW_BRANCH"` — remote check
  - If either hits, ask the user to pick a different name (e.g. `release/v0.8.5-rc`, `release/v0.8.5-2`).
- Count the fdj commits to be replayed:
  ```
  REPLAY_COUNT=$(git log --no-merges --oneline $PREV_UPSTREAM_VERSION..$START_BRANCH | wc -l)
  ```
- Show the plan to the user:
  ```
  Starting branch:    $START_BRANCH (based on $PREV_UPSTREAM_VERSION)
  Sync target:        $UPSTREAM_REF
  Phase 1:            main → merge $UPSTREAM_REF
  Phase 2:            cut $NEW_BRANCH from synced main,
                      replay $REPLAY_COUNT fdj commits onto it
  Original branch:    $START_BRANCH stays untouched (no force-push)
  ```
- Use AskUserQuestion: **Proceed** (Recommended) / **Override new branch name** / **Abort**.
- If override: re-prompt for branch name, re-check collision.

**Otherwise** (unrecognized branch — e.g. a feature branch):
- Use AskUserQuestion:
  - **Sync main only** — treat this as a Phase-1-only run; you'll handle replays yourself afterwards.
  - **Treat as release branch** — ask the user which upstream version this branch was based on, then continue as two-phase.
  - **Abort.**

# Step 2: Safety net for `main`

We only modify `main` in Phase 1 — that's the only branch needing a backup.

Capture main's pre-update state:
- `git fetch origin main` (already done in Step 0, idempotent)
- `MAIN_HASH=$(git rev-parse --short refs/heads/main 2>/dev/null || git rev-parse --short origin/main)`
- `TIMESTAMP=$(date +%Y%m%d-%H%M%S)`
- `MAIN_BACKUP_TAG=pre-update-main-$MAIN_HASH-$TIMESTAMP`
- `MAIN_BACKUP_BRANCH=backup/$MAIN_BACKUP_TAG`

Create the backup ref pointing at main's current tip (without checking out):
- `git tag $MAIN_BACKUP_TAG refs/heads/main 2>/dev/null || git tag $MAIN_BACKUP_TAG origin/main`
- `git branch $MAIN_BACKUP_BRANCH refs/heads/main 2>/dev/null || git branch $MAIN_BACKUP_BRANCH origin/main`

Save `$MAIN_BACKUP_TAG` and `$MAIN_BACKUP_BRANCH` for the summary.

The starting release branch is never modified, so no backup is needed for it.

# Step 3: Preview upstream changes (no edits yet)

Compute the common base between current `main` and the chosen ref:
- `BASE=$(git merge-base refs/heads/main $UPSTREAM_REF 2>/dev/null || git merge-base origin/main $UPSTREAM_REF)`

Show upstream commits since BASE:
- `git log --oneline $BASE..$UPSTREAM_REF`

Show file-level impact:
- `git diff --name-only $BASE..$UPSTREAM_REF`

Bucket the upstream changed files for the user, in this order:

1. **MCP fork hotspot** (`client/src/components/MCP/`, `client/src/hooks/MCP/`, anything matching `*MCPConfirmation*`) — call out loudly. The MCP confirmation dialog is fork-only work in progress (see `client/src/components/MCP/MCPConfirmationDialog.tsx`). Any upstream change here is almost guaranteed to need careful conflict review during Phase 2.
2. **Shared types** (`packages/data-provider/`) — if changed, `npm run build:data-provider` is mandatory after merge.
3. **TS backend** (`packages/api/`, `packages/data-schemas/`).
4. **Legacy JS backend** (`api/`).
5. **Frontend** (`client/`, `packages/client/`).
6. **Config** (`librechat.yaml`, `.env.example`, `config/`) — fork has local MCP config that may diverge.
7. **Build/manifest** (`package.json`, `package-lock.json`, `tsconfig*.json`, `turbo.json`) — Step 6 will offer `npm install` if any of these changed.
8. **Docs/tests/CI** — usually safe.

**Large drift check:** if the upstream commit count is high and `$BASE` is far behind, mention this honestly so the user can decide whether to abort and sync to an intermediate tag first.

# Step 4: Phase 1 — Sync `main` to upstream

1. Checkout `main`:
   - `git checkout main`
2. Fast-forward to origin:
   - `git pull --ff-only origin main`
   - If this fails (non-fast-forward), **stop** and tell the user `main` has diverged from `origin/main` — they need to reconcile manually before re-running the skill.
3. Conflict preview (dry run):
   ```
   git merge --no-commit --no-ff $UPSTREAM_REF; git diff --name-only --diff-filter=U; git merge --abort
   ```
   If conflicts listed: flag any under `client/src/components/MCP/` or `librechat.yaml` and ask the user to confirm before proceeding. If clean: say so and proceed.
4. Merge upstream into main:
   - `git merge $UPSTREAM_REF --no-edit`
5. If conflicts occur: follow the **Conflict triage protocol** below. When complete, the merge commit is in place.
6. Run **Step 6 (dependency sync)** and **Step 7 (validation)** on `main`.
7. **Do not push yet.** Phase 1's changes stay local until the publish gate in Step 9.

If `WORKFLOW=phase1-only`: skip Step 5; go to Step 8.

# Conflict triage protocol (used by Step 4 and Step 5)

Whenever `git merge` or `git cherry-pick` produces a conflict, follow this protocol per conflicted file. **Default to non-trivial when in doubt** — over-asking is cheap; silently landing a wrong resolution on `main` or a release branch is not.

## A. Enumerate conflicts
- `git status --short` to list conflicted files (marked `UU`, `AA`, `DD`, `AU`, `UA`, etc.)
- For each file, count blocks: `grep -c '^<<<<<<<' <file>` — this is how many marker pairs need a decision.

## B. Special case — lockfile conflicts
If `package-lock.json` is conflicted, **do not edit markers**. Instead:
- Resolve any conflicts in `package.json` files first (per protocol below), stage them.
- `rm package-lock.json && npm install` to regenerate from the merged manifests.
- `git add package-lock.json`

## C. Classify each conflict block

**Trivial — auto-resolve, log a one-line note, do not interrupt the user:**
- Whitespace-only differences (tabs, trailing spaces, blank lines)
- Import statement reordering (no new imports added, none removed)
- Version string bumps in `package.json` (e.g. `"0.8.4"` → `"0.8.5"`)
- Comment-only or JSDoc-only differences
- Pure formatting changes already covered by Prettier/ESLint

For each trivial block: apply the resolution, log a one-liner like `[trivial] api/package.json:3 — version 0.8.4 → 0.8.5, kept upstream`.

**Non-trivial — propose, approve, then stage (see step D):**
- ANY conflict under `api/`, `packages/api/`, `packages/data-schemas/`
- ANY conflict under `client/src/components/MCP/`, `client/src/hooks/MCP/`, or matching `*MCPConfirmation*`
- ANY conflict in `librechat.yaml`, `.env.example`, `config/`
- New imports added or removed
- Changes to control flow, type signatures, function bodies, exported APIs, error handling, default values, environment variable handling
- Authentication, MCP, OIDC, or token-handling code anywhere in the tree
- Anywhere classification confidence is below ~95%

## D. Non-trivial blocks — propose / approve / stage

For each non-trivial block:

1. Show the marker block exactly as it appears in the file, with ~5 lines of surrounding context above and below.
2. Show the proposed resolution side-by-side — usually a merge of both sides — and annotate which lines come from fork (HEAD / cherry-pick target), which come from upstream / the picked commit, and which are new.
3. State briefly what intent is being preserved and what change is being incorporated. Example: *"Keeping fork's `audit(req.user, ...)` call (FDJ logging requirement). Adopting upstream's `await loadTools({ cache: true })` for the cache fix in v0.8.5."*
4. Use AskUserQuestion:
   - **Apply proposed resolution** (Recommended)
   - **Keep fork side only** (HEAD before merge / target before pick)
   - **Keep upstream/incoming side only**
   - **Skip — I'll resolve manually**

5. Apply the chosen action. If "Skip," do not stage the file yet — note the path; at the end pause the skill until the user has cleaned markers and run `git add` themselves.

If a single file has many non-trivial blocks (>5), offer one bulk option up front: "Show me all blocks first, then ask per-block" vs "Open the file in my IDE, I'll resolve it whole."

## E. Stage and continue
- After every block in a file is resolved (no markers remain), `git add <file>`.
- After every file is processed: `git diff --check` should show no remaining conflict markers anywhere.
- If any files were skipped, **pause the skill** and wait — explicitly print the list of paths needing manual resolution.
- When all conflicted files are staged, complete the in-flight operation:
  - merge: `git commit --no-edit` (if not auto-committed)
  - cherry-pick: `git cherry-pick --continue`

# Step 5: Phase 2 — Cut new release branch and replay fdj patches

Only runs if `WORKFLOW=two-phase`.

1. Compute the ordered list of fdj commits to replay:
   ```
   git log --no-merges --reverse --format='%h %s' $PREV_UPSTREAM_VERSION..$START_BRANCH
   ```
   Show the list to the user. Ask via AskUserQuestion:
   - **Replay all $REPLAY_COUNT commits** (Recommended)
   - **Select a subset** — user types commit hashes or ranges
   - **Abort Phase 2** — leave main synced (already pushed if user approved in Phase 1), do nothing further

2. Create the new branch from synced `main`:
   - `git checkout -b $NEW_BRANCH main`

3. Cherry-pick the commits, one at a time, in order:
   - For each commit hash in the replay list:
     - `git cherry-pick <hash>`
     - If conflicts: follow the **Conflict triage protocol** above, then `git cherry-pick --continue`.
     - If the user aborts mid-sequence: `git cherry-pick --abort`, then ask whether to keep the new branch with partial replay or delete it (`git checkout main && git branch -D $NEW_BRANCH`).
   - Empty cherry-picks (commit already in upstream): `git cherry-pick --skip` automatically; log a one-liner noting which commit was skipped.

4. After all commits are replayed, run **Step 6 (dependency sync)** and **Step 7 (validation)** again — fdj patches may modify deps or types.

5. **Do not push yet.** Phase 2's new branch stays local until the publish gate in Step 9.

# Step 6: Dependency sync (only if manifests changed)

Run this after Phase 1's merge AND, separately, after Phase 2's replay (manifest changes can come from either side).

Check whether the most recent operation touched any manifest or lockfile:
- For Phase 1: `git diff $MAIN_BACKUP_TAG..HEAD --name-only | grep -E '(^|/)(package\.json|package-lock\.json)$'`
- For Phase 2: `git diff main..HEAD --name-only | grep -E '(^|/)(package\.json|package-lock\.json)$'`

If nothing matched: skip — `node_modules` is still in sync. Proceed to Step 7.

If anything matched: validation in Step 7 would otherwise run against stale `node_modules`. Use AskUserQuestion:
- **Run `npm install` now** (Recommended)
- **Skip — I'll handle deps myself** (validation may fail with module-not-found errors)

If Run: `npm install`. If it fails (peer-dep conflicts, registry issues), surface the error and ask the user before retrying or skipping.

# Step 7: Validation

## 7a — Build

Run, in order:
- `npm run build:data-provider` — shared types must be current before downstream packages compile.
- `npm run build` — Turborepo orchestrates the rest; cached where possible.

If either fails: show the error and only fix issues clearly caused by the merge/replay (missing imports, type mismatches from merged code). Do not refactor unrelated code. If unclear, ask the user.

## 7b — Static require sweep (catches a class build can't catch)

**Why this exists**: the build doesn't execute the legacy `api/` CommonJS code, so a fork patch that does `require('~/foo/bar')` against a path upstream has moved (or never had) will pass `npm run build` but crash at backend startup. Real example: a fork patch in `api/app/clients/tools/structured/OpenAIImageTools.js` required `~/models/spendTokens` — that submodule existed at v0.8.4 but was consolidated into `packages/data-schemas` for v0.8.5. The require resolved at git-merge time (no conflict), passed the build, and crashed `npm run backend` with `Cannot find module`. This sweep catches that class of issue before the publish gate.

**Scope**: only fork-touched JS files in `api/` (where `module-alias` maps `~/` → `api/`). The sweep doesn't look at TS code under `packages/` (different resolver).

**Range to scan**:
- Phase 1: `$MAIN_BACKUP_TAG..HEAD` on `main` (post-merge changes)
- Phase 2: `main..HEAD` on `$NEW_BRANCH` (the replayed fdj commits)

**Run**:
```bash
RANGE=...  # set per phase
git diff --name-only $RANGE -- 'api/**/*.js' | while read f; do
  [ -f "$f" ] || continue
  grep -nE "(require\(|from )['\"]~/[^'\"]+['\"]" "$f" | while read -r line; do
    p=$(echo "$line" | sed -E "s|.*['\"]~/||; s|['\"].*$||")
    if [ ! -e "api/$p.js" ] && [ ! -e "api/$p/index.js" ] && \
       [ ! -e "api/$p.cjs" ] && [ ! -e "api/$p/index.cjs" ]; then
      echo "BROKEN  $f  →  ~/$p"
    fi
  done
done
```

If the sweep returns nothing: log "✓ require sweep clean" and proceed.

If the sweep returns one or more lines: surface them clearly and use AskUserQuestion:
- **Fix each broken require interactively** (Recommended) — for each hit, open the file at the matched line, show what's there, propose a fix (typical fix: change `require('~/foo/bar')` to `require('~/foo')` if `bar` was consolidated into the parent index — verify by checking what the parent index exports), and ask: Apply / Keep as-is / Skip this one.
- **Flag in summary and continue** — the upgrade proceeds; broken requires are listed in Step 10's summary as `⚠ N broken requires — smoke test WILL fail until fixed`.
- **Abort and roll back** — see the rollback paragraph below.

**Important — what this sweep does NOT catch**:
- TypeScript path-alias mismatches in `packages/api/` (different resolver)
- Dynamic requires whose path comes from a variable
- Wrong *named* exports from a still-valid module (`require('~/models').foo` returning `undefined` because `foo` was renamed)
- Anything logically broken but syntactically resolved

Smoke-testing the running app (Step 10's recommendation) is still the ultimate validation. The sweep is a cheap first pass.

## 7c — Rollback offer

If 7a build is broken and you cannot pinpoint a fix in a few attempts, OR if 7b sweep finds broken requires you cannot easily resolve, **stop and offer rollback**:
- **Phase 1 failure**: `git reset --hard $MAIN_BACKUP_TAG` returns `main` to its pre-merge state. Suggest re-running the skill targeting a smaller upstream tag.
- **Phase 2 failure**: `git checkout main && git branch -D $NEW_BRANCH` drops the new release branch. The starting release branch is untouched. Suggest re-running Phase 2 with a smaller subset of fdj commits to localize the breakage.

# Step 8: Breaking changes check

After validation succeeds, scan the merged commit history and any release notes for breaking-change markers.

LibreChat upstream uses Conventional Commits — breaking changes appear as `feat!:`, `fix!:`, or a `BREAKING CHANGE:` footer.

Check commit messages between BASE and the synced ref:
- `git log $BASE..$UPSTREAM_REF --grep='BREAKING CHANGE' --grep='!:' --regexp-ignore-case`

Also check release notes if they exist in the tree:
- `git diff $MAIN_BACKUP_TAG..main -- CHANGELOG.md changelog/ docs/changelog/` (skip silently if none of those paths exist)

If hits found:
- Display a warning: "This update includes potential breaking changes — review before deploying:"
- For each hit, show the commit hash + subject (or CHANGELOG section).
- Recommend `npm run backend` + `npm run frontend:dev` to verify behaviour locally before pushing.

If nothing matches: say so in one line and proceed.

# Step 9: Publish (push to `origin`)

This is the only place where the skill pushes to a shared remote. By this point everything is built, validated, and reviewed locally — nothing has been published yet.

Show the user what would be pushed:
```
main:           $MAIN_HASH → $(git rev-parse --short main)   (validated locally)
$NEW_BRANCH:    new branch                                   (validated locally)
                based on synced main + $REPLAY_COUNT replayed fdj commits
```

(If `WORKFLOW=phase1-only`, only the `main` line is shown.)

Before asking, verify the new release branch doesn't already exist on origin (someone might have pushed during the run):
- `git ls-remote --exit-code --heads origin "$NEW_BRANCH"`
- If it exists, surface this loudly and refuse to overwrite. Ask the user to pick a new local name (`git branch -m $NEW_BRANCH $NEW_BRANCH-2`) or delete the remote ref themselves before re-running this step. **Never `--force`.**

Use AskUserQuestion:
- **Push all branches** (Recommended) — pushes `main`, then `$NEW_BRANCH`
- **Push only `main`** — leave `$NEW_BRANCH` local for further review
- **Push only `$NEW_BRANCH`** — leave `main` local (rare; only if `main` has unrelated work that shouldn't be published yet)
- **Skip — I'll push manually**

If pushing `main`:
- `git push origin main`
- If push fails (e.g. remote `main` moved since Step 4's ff-pull), surface the error. Do NOT auto-rebase or force-push. Tell the user to reconcile manually and re-run this step.

If pushing the new release branch (two-phase only):
- `git push -u origin "$NEW_BRANCH"`
- If push fails for any reason (network, hooks, protection rules), surface the error. Same rule — no force.

Record which branches were pushed for the summary.

# Step 10: Summary

Show:
- Starting branch: `$START_BRANCH` (untouched — no force-push happened)
- Workflow: `$WORKFLOW`
- Synced to: `$UPSTREAM_REF`
- `main`: `$MAIN_HASH` → `$(git rev-parse --short main)`, pushed to origin: **yes / no**
- (Two-phase only) New release branch: `$NEW_BRANCH`, based on synced `main` + `$REPLAY_COUNT` replayed fdj commits, pushed: **yes / no**
- Main backup tag (for rollback): `$MAIN_BACKUP_TAG`
- Conflicts resolved across both phases (list files, if any)
- MCP fork hotspot files touched (list, if any) — smoke-test the confirmation dialog before/after pushing
- **Broken requires flagged at Step 7b** (if any were flagged-and-skipped, list each `<file> → ~/<path>`) — surface as a `⚠ WARNING: backend WILL crash at startup until these are fixed` block. Show the typical fix pattern (consolidate `require('~/foo/bar')` into `require('~/foo')` if `bar` was rolled into the parent index). Recommend fixing on the new release branch *before* pushing if not done already.

If anything was NOT pushed in Step 9, remind the user of the manual commands:
- `git push origin main`
- `git push -u origin $NEW_BRANCH`

Recommended next steps:
1. `npm run backend` + `npm run frontend:dev` — smoke-test the MCP confirmation dialog and at least one MCP server (Atlassian or Ms-Teams) end-to-end.
2. Push any remaining branches when ready.
3. Never force-push.

Rollback paths:
- Roll back `main` (if not pushed): `git checkout main && git reset --hard $MAIN_BACKUP_TAG`.
- Roll back `main` (if pushed): same reset, then coordinate with anyone who pulled `main`; a force-push is required and is destructive — avoid unless the merge genuinely needs to be undone.
- Drop the new release branch (if not pushed): `git checkout main && git branch -D $NEW_BRANCH`.
- Drop the new release branch (if pushed): `git push origin --delete $NEW_BRANCH`, then delete locally.
- Starting release branch `$START_BRANCH` was never modified — nothing to undo there.
