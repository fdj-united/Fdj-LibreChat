---
name: update-librechat
description: Upgrade the fdj-united fork from upstream LibreChat using a guarded two-phase workflow. Always asks first whether to update dev (`release/vX.Y.Z-fdjN`), prod (`prod/vX.Y.Z-fdjN`), or both; syncs main once, creates new environment-specific branches, replays each environment's fork patches independently, validates, and publishes only after explicit approval. Starting deployment branches are never modified or force-pushed.
---

# About

This fork (`fdj-united/Fdj-LibreChat`) treats dev and prod deployment branches as immutable source artifacts. Dev uses `release/v<X.Y.Z>-fdj<N>` (existing unsuffixed `release/v<X.Y.Z>` branches are accepted as sources); prod uses `prod/v<X.Y.Z>-fdj<N>`. Upgrading means:

1. Ask whether the upgrade targets **dev**, **prod**, or **both**. This is always the first question.
2. Sync `main` once to the new upstream tag (or `upstream/main` tip).
3. For each selected environment, choose its existing source branch and an exact new destination branch name.
4. Create each destination from synced `main` and replay that environment's fdj-specific commits independently.

Canonical destination names are `release/v<new-version>-fdj<N>` for dev and `prod/v<new-version>-fdj<N>` for prod. Do not invent `<N>`: ask the user for the exact destination name and validate its prefix, version, suffix, and non-existence locally and remotely. `/merge-feature` continues to create global annotated `v<version>-fdj<N>` tags.

Source deployment branches are never touched. No force-pushes. When **both** is selected, each branch is replayed and validated separately after the single `main` sync; do not copy one environment's resulting branch into the other.

Run `/update-librechat` in Claude Code.

## How it works

**Environment selection**: before any repository inspection, asks **dev**, **prod**, or **both**. This choice controls source discovery, destination naming, replay, validation, publish, rollback, and summary.

**Preflight**: after environment selection, requires a clean working tree (`git status --porcelain`). The `upstream` remote should already point at `https://github.com/danny-avila/LibreChat.git`; if missing, asks for the URL and adds it. Fetches branches and tags.

**Upstream reference selection**: asks whether to sync to a specific upstream release tag (recommended) or the tip of `upstream/main`. If tag, shows the most recent ~15 release tags so you can pick. The chosen ref (e.g. `v0.8.5` or `upstream/main`) is used for both phases.

**Workflow planning**: for each selected environment, lists matching local and remote source branches and asks which one to upgrade. Dev sources come from `release/`; prod sources come from `prod/`. The current branch may be recommended only when it belongs to that environment. The skill then asks for each exact destination branch name and validates it. With **both**, dev and prod keep separate source branches, commit lists, conflict decisions, validation results, and destination branches.

**Phase 1 — Sync `main` (local only)**

1. Checkout `main`, ff-pull from `origin/main` (stop if main has diverged from its remote).
2. Dry-run merge to preview conflicts.
3. Merge the chosen upstream ref into `main`.
4. Triage any conflicts per block (see triage protocol).
5. Offer `npm install` if any manifest changed; run `npm run build:data-provider` + `npm run build`.
6. **Nothing is pushed yet** — all changes stay local until the final publish gate.

**Phase 2 — Cut selected environment branches + replay fdj patches (local only)**

1. For each selected environment, compute its own replay list from its source branch and show it for confirmation.
2. Create that environment's new destination branch from synced `main`.
3. Cherry-pick only that source environment's selected commits, one at a time.
4. Triage conflicts per commit and validate the completed branch.
5. Return to `main`, then repeat for the next environment when **both** was selected.
6. **Nothing is pushed yet** — see the publish gate below.

**Publish gate (final step before summary)**: shows everything about to be pushed: `main` and every selected environment branch with its replay count and validation result. The user chooses exactly which refs to publish. Pushes `main` first, then each approved dev/prod branch. If a push fails, surfaces the error and stops — no auto-rebase and no force-push.

**Conflict resolution** (triage protocol, used in both phases): for every conflict block, classifies it as **trivial** (whitespace, import reorder, version bump, comment-only) or **non-trivial** (backend logic, MCP code, config, type/control-flow changes). Trivial blocks auto-resolve with a one-line note. Non-trivial blocks pause for you: shows the marker block with surrounding context + the proposed resolution + reasoning, and asks you to **Apply / Keep fork only / Keep upstream only / Skip (resolve manually)**. Lockfile conflicts regenerate via `npm install`, never hand-edit. Default to asking when classification confidence is below ~95%.

**Static require sweep** (Step 7b): after the build passes, scans fork-touched `api/**/*.js` files for `require('~/...')` and `import ... from '~/...'` paths whose target no longer exists. Catches the class of regression where upstream moves a file (e.g. `api/models/spendTokens.js` → `packages/data-schemas/`) and your fork patch still references the old path — these resolve at git-merge time, pass `npm run build`, and crash only at backend startup. Best-effort: doesn't catch TS path mismatches, dynamic requires, or wrong named exports. Not a replacement for smoke-testing.

**Breaking-change scan**: greps Conventional Commits markers (`feat!:`, `fix!:`, `BREAKING CHANGE:`) in the merged commit log, plus any `CHANGELOG.md` changes, and surfaces hits before you push.

**Summary**: shows the environment choice, new HEAD of `main`, every selected source→destination mapping and replay count, validation/push status per environment, backup tag for main rollback, conflicts resolved, MCP hotspot files touched, and smoke-test recommendations.

## Rollback

- **Main**: backup tag `pre-update-main-<hash>-<timestamp>` is printed at the end. To roll back: `git reset --hard <backup-tag>` while on `main`.
- **New deployment branch**: delete only the exact destination created for that environment. If pushed, delete its remote ref separately after explicit confirmation.
- **Starting deployment branches**: **never modified by this skill**. No rollback is needed for them.

## Token usage

Only opens files with actual conflicts. Uses `git log`, `git diff`, and `git status` for everything else. Does not scan or refactor unrelated code.

---

# Goal

Bring upstream `danny-avila/LibreChat` changes into the fork by selecting dev, prod, or both first; keeping `main` as a clean upstream mirror; and cutting new immutable environment branches while leaving all source branches untouched.

# Operating principles

- The first interaction must ask **dev, prod, or both**. Do not run git commands, inspect the current branch, or infer the choice before the user answers.
- Never proceed with a dirty working tree.
- Always create rollback points before modifying `main`.
- Never modify a selected source branch. Phase 2 creates a NEW branch for each selected environment.
- In **both** mode, never derive prod from the new dev branch or dev from the new prod branch. Replay each environment's own source commits independently onto the same synced `main` base.
- Prefer git-native operations (fetch, merge, cherry-pick). Do not manually rewrite files except conflict markers.
- Never force-push, never rewrite shared history, never `--no-verify` without explicit user say-so.
- Ask before any `git push`. `main` is shared.
- Keep token usage low: rely on `git status`, `git log`, `git diff`, and open only conflicted files.

# Step -1: Choose deployment environments

This must be the first interaction in every invocation. Before running any git command or inspecting the current branch, use AskUserQuestion:

- **Dev** — upgrade only the development line under `release/`.
- **Prod** — upgrade only the production line under `prod/`.
- **Both** (Recommended when both lines must move together) — upgrade dev and prod independently from their own source branches after one shared `main` sync.

Do not infer this choice from the checked-out branch, branch availability, or prior conversation. Wait for the answer, then set `TARGET_ENVS` to `dev`, `prod`, or `dev prod`. Use these definitions throughout:

| Environment | Source branches                                                                  | New destination branch  |
| ----------- | -------------------------------------------------------------------------------- | ----------------------- |
| dev         | `release/v<X.Y.Z>-fdj<N>`; accept existing `release/v<X.Y.Z>` as a legacy source | `release/v<new>-fdj<N>` |
| prod        | `prod/v<X.Y.Z>-fdj<N>`                                                           | `prod/v<new>-fdj<N>`    |

The environment selection governs every later source, destination, replay, validation, publish, rollback, and summary action. Never touch an unselected environment.

# Step 0: Preflight (stop early if unsafe)

Run:

- `git status --porcelain`

If output is non-empty:

- Tell the user to commit or stash first, then stop.

Capture the invoking branch for context only:

- `INVOKING_BRANCH=$(git rev-parse --abbrev-ref HEAD)`

Do not treat `$INVOKING_BRANCH` as the source automatically. Source selection is explicit in Step 1, especially when **both** is selected.

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

- Option A (Recommended): **Sync to a specific upstream release tag** — controlled and supplies the version component for every selected destination branch.
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
- If `$INVOKING_BRANCH` matches a selected environment's branch shape, parse its version (e.g. `v0.8.4`) and label it "currently checked out" for context only. Do not use that as implicit source selection.
- Ask the user to type the tag they want. Validate: `git rev-parse --verify "refs/tags/$TAG"`. If invalid, re-show the list and re-prompt.
- Set `UPSTREAM_REF=$TAG` and `UPSTREAM_VERSION=$TAG` (e.g. `v0.8.5`).

For the rest of the skill, all git operations use `$UPSTREAM_REF` (either a tag like `v0.8.5` or a branch ref like `upstream/main`).

# Step 1: Plan the workflow

Plan one independent replay for every value in `$TARGET_ENVS`. Use per-environment variables (for example, `SOURCE_BRANCH_DEV`, `NEW_BRANCH_DEV`, and `REPLAY_COUNT_DEV`) rather than overwriting one environment's state with another's.

For each selected environment:

1. Set its branch rules:
   - dev: root `release`; source regex `^release/v[0-9]+\.[0-9]+\.[0-9]+(-fdj[0-9]+)?$`; destination regex `^release/v[0-9]+\.[0-9]+\.[0-9]+-fdj[0-9]+$`.
   - prod: root `prod`; source and destination regex `^prod/v[0-9]+\.[0-9]+\.[0-9]+-fdj[0-9]+$`.
2. Enumerate matching branches from local refs and `origin`, newest first. Do not show or accept branches from the other environment.
3. Ask the user to select the exact source branch. Even if only one candidate exists, confirm it; never infer it from `$INVOKING_BRANCH`. Resolve it to an immutable `$SOURCE_REF_<ENV>`: use the local branch when present, otherwise fetch and use `origin/<branch>`. Record the display name separately as `$SOURCE_BRANCH_<ENV>`.
4. Parse `PREV_UPSTREAM_VERSION_<ENV>` from the source name and verify the corresponding tag exists. If it does not, ask which upstream tag that source branch was based on and validate the answer.
   - If `$UPSTREAM_VERSION` is set and is older than this environment's previous upstream version, warn that this is a downgrade and require explicit confirmation for that environment.
5. Ask for the exact new destination branch name. Do not invent the fdj number.
   - If an upstream tag was selected, require the destination's `v<X.Y.Z>` component to equal `$UPSTREAM_VERSION`.
   - If branch-tip mode was selected, ask for the intended `v<X.Y.Z>` label before validating the destination.
   - Require the destination to match that environment's destination regex.
6. Verify the destination does not exist locally or on origin:
   ```bash
   git rev-parse --verify "refs/heads/$NEW_BRANCH" 2>/dev/null
   git ls-remote --exit-code --heads origin "$NEW_BRANCH"
   ```
   If either command finds it, ask for another name. Never overwrite or reuse an existing destination.
7. Count and record the commits to replay:
   ```bash
   REPLAY_COUNT=$(git log --no-merges --oneline "$PREV_UPSTREAM_VERSION..$SOURCE_REF" | wc -l)
   ```

Show one consolidated plan:

```text
Environments:       $TARGET_ENVS
Sync target:        $UPSTREAM_REF
Phase 1:            main → merge $UPSTREAM_REF (once)
Dev, if selected:   $SOURCE_BRANCH_DEV → $NEW_BRANCH_DEV ($REPLAY_COUNT_DEV commits)
Prod, if selected:  $SOURCE_BRANCH_PROD → $NEW_BRANCH_PROD ($REPLAY_COUNT_PROD commits)
Source branches:    untouched
```

Use AskUserQuestion: **Proceed** (Recommended) / **Change branch selections or names** / **Abort**. Revalidate every changed value before continuing.

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

Selected source branches are never modified, so no backup is needed for them.

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

# Conflict triage protocol (used by Step 4 and Step 5)

Whenever `git merge` or `git cherry-pick` produces a conflict, follow this protocol per conflicted file. **Default to non-trivial when in doubt** — over-asking is cheap; silently landing a wrong resolution on `main` or a deployment branch is not.

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
3. State briefly what intent is being preserved and what change is being incorporated. Example: _"Keeping fork's `audit(req.user, ...)` call (FDJ logging requirement). Adopting upstream's `await loadTools({ cache: true })` for the cache fix in v0.8.5."_
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

# Step 5: Phase 2 — Create and validate each selected deployment branch

Process `$TARGET_ENVS` one at a time. For **both**, finish dev through validation, return to `main`, then process prod. Keep separate logs of chosen commits, conflicts, fixes, warnings, and validation results.

For the current environment:

1. Bind its recorded values to `$SOURCE_BRANCH`, `$SOURCE_REF`, `$PREV_UPSTREAM_VERSION`, `$NEW_BRANCH`, and `$REPLAY_COUNT`.
2. Compute and show the ordered replay list:
   ```bash
   git log --no-merges --reverse --format='%h %s' "$PREV_UPSTREAM_VERSION..$SOURCE_REF"
   ```
   Ask via AskUserQuestion:
   - **Replay all `$REPLAY_COUNT` commits** (Recommended)
   - **Select a subset** — user supplies commit hashes or ranges
   - **Skip this environment** — do not create its destination branch
   - **Abort the upgrade** — stop; leave completed local work and report it
3. Return to validated synced `main`, then create the destination:
   - `git checkout main`
   - `git checkout -b "$NEW_BRANCH" main`
4. Cherry-pick the selected commits one at a time in order.
   - On conflicts, follow the conflict triage protocol, then `git cherry-pick --continue`.
   - For an empty cherry-pick whose effect is already upstream, use `git cherry-pick --skip` and record it.
   - If the user aborts mid-sequence, run `git cherry-pick --abort`, then ask whether to keep or delete only this new local destination branch.
5. Run Step 6 and Step 7 for this destination. Record success or failure before processing another environment.
6. If another environment remains, `git checkout main` and repeat from item 1. Never use the completed dev destination as prod's base or vice versa.

Do not push any branch yet. Publishing happens only in Step 9 after all selected environments have been processed.

# Step 6: Dependency sync (only if manifests changed)

Run this after Phase 1's merge and separately after each selected environment's replay (manifest changes can come from any side).

Check whether the most recent operation touched any manifest or lockfile:

- For Phase 1: `git diff $MAIN_BACKUP_TAG..HEAD --name-only | grep -E '(^|/)(package\.json|package-lock\.json)$'`
- For each environment branch: `git diff main..HEAD --name-only | grep -E '(^|/)(package\.json|package-lock\.json)$'`

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
- Each environment: `main..HEAD` while checked out on that environment's `$NEW_BRANCH`.

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
- Wrong _named_ exports from a still-valid module (`require('~/models').foo` returning `undefined` because `foo` was renamed)
- Anything logically broken but syntactically resolved

Smoke-testing the running app (Step 10's recommendation) is still the ultimate validation. The sweep is a cheap first pass.

## 7c — Rollback offer

If 7a build is broken and you cannot pinpoint a fix in a few attempts, OR if 7b sweep finds broken requires you cannot easily resolve, **stop and offer rollback**:

- **Phase 1 failure**: `git reset --hard $MAIN_BACKUP_TAG` returns `main` to its pre-merge state. Suggest re-running the skill targeting a smaller upstream tag.
- **Environment replay failure**: `git checkout main && git branch -D "$NEW_BRANCH"` drops only that new destination branch. All source branches and any already-completed destination for the other environment remain untouched. Suggest retrying that environment with a smaller subset.

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

Show the user one row per ref:

```text
main:  $MAIN_HASH → <new-main-hash>                       validated: yes/no
dev:   $SOURCE_BRANCH_DEV → $NEW_BRANCH_DEV               commits: N, validated: yes/no
prod:  $SOURCE_BRANCH_PROD → $NEW_BRANCH_PROD             commits: N, validated: yes/no
```

Omit unselected or skipped environments. Never offer an environment branch whose validation failed.

Immediately before asking, fetch origin and re-check every selected destination branch. If any destination now exists remotely, refuse to overwrite it and ask for a new local destination name. Revalidate the renamed branch. **Never force-push.**

Use AskUserQuestion:

- **Push all validated refs** (Recommended) — pushes `main`, then every validated selected environment branch
- **Choose refs to push** — the user explicitly selects `main`, dev, and/or prod
- **Skip — I'll push manually**

If pushing `main`:

- `git push origin main`
- If push fails (e.g. remote `main` moved since Step 4's ff-pull), surface the error. Do NOT auto-rebase or force-push. Tell the user to reconcile manually and re-run this step.

For each approved environment branch:

- `git push -u origin "$NEW_BRANCH"`
- If push fails for any reason, stop before pushing another environment, surface exactly which refs succeeded, and never force.

Record push status separately for `main`, dev, and prod.

# Step 10: Summary

Show:

- Requested environments: `$TARGET_ENVS`
- Invoking branch: `$INVOKING_BRANCH` (context only)
- Synced to: `$UPSTREAM_REF`
- `main`: `$MAIN_HASH` → `$(git rev-parse --short main)`, pushed to origin: **yes / no**
- For every selected environment: source branch, source upstream base, destination branch, selected/replayed/skipped commits, validation result, and push result
- Main backup tag (for rollback): `$MAIN_BACKUP_TAG`
- Conflicts resolved on `main` and per environment (list files, if any)
- MCP fork hotspot files touched (list, if any) — smoke-test the confirmation dialog before/after pushing
- **Broken requires flagged at Step 7b**: group them by destination branch and surface the existing crash warning for each affected branch.

If anything was NOT pushed in Step 9, remind the user of the manual commands:

- `git push origin main`
- `git push -u origin $NEW_BRANCH_DEV` (if dev was selected and not pushed)
- `git push -u origin $NEW_BRANCH_PROD` (if prod was selected and not pushed)

Recommended next steps:

1. `npm run backend` + `npm run frontend:dev` — smoke-test the MCP confirmation dialog and at least one MCP server (Atlassian or Ms-Teams) end-to-end.
2. Push any remaining branches when ready.
3. Never force-push.

Rollback paths:

- Roll back `main` (if not pushed): `git checkout main && git reset --hard $MAIN_BACKUP_TAG`.
- Roll back `main` (if pushed): same reset, then coordinate with anyone who pulled `main`; a force-push is required and is destructive — avoid unless the merge genuinely needs to be undone.
- Drop a new environment branch (if not pushed): `git checkout main && git branch -D "$NEW_BRANCH"`.
- Drop a pushed environment branch only after explicit confirmation: `git push origin --delete "$NEW_BRANCH"`, then delete it locally.
- Selected source branches were never modified — nothing to undo there.
