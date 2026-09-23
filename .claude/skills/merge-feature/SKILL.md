---
name: merge-feature
description: Merge a feature branch into either a development branch (`release/vX.Y.Z-fdjN`, with existing unsuffixed release branches supported) or a production branch (`prod/vX.Y.Z-fdjN`) using a guarded rebase-then-merge workflow. Always asks whether the target is dev or prod before inspecting or changing the repository, validates, creates an annotated `vX.Y.Z-fdjN` tag, and defers publishing to one final approval gate.
---

# About

This fork's workflow for shipping a feature into a selected deployment branch:

1. Ask whether this merge targets **dev** (`release/v<version>-fdj<N>`) or **prod** (`prod/v<version>-fdj<N>`). This is always the first question; never infer the environment from the current branch.
2. Develop on a feature branch (e.g. `feat/mcp-confirmation-clear`).
3. Rebase the feature branch onto the selected target tip, surfacing conflicts per commit and producing a clean linear feature history.
4. Merge with `--no-ff` so the merge commit is preserved.
5. Validate the selected target branch builds.
6. **Tag the merge commit as `v<upstream>-fdj<next>`** — the fdj counter increments globally per upstream version. The selected branch name **does not move**; tags accumulate on that branch.
7. Push only after everything is local-clean — branch and tag together.
8. Delete the feature branch (asked, not automatic).

Tag naming: the upstream version prefix is parsed from the selected branch name. `release/v0.8.4`, `release/v0.8.4-fdj11`, and `prod/v0.8.4-fdj11` all yield prefix `v0.8.4`. The next fdj number is `max(existing v0.8.4-fdj* tags) + 1` (or `1` if none), regardless of environment, so dev and prod cannot create colliding tags.

**Direct commits to the selected target branch are intentionally NOT tagged.** Each `v<upstream>-fdj<N>` tag points at a merge commit produced by this skill. Direct commits that landed on that branch between feature merges are covered by the next merge's tag because they are ancestors of the merge commit. To mark a direct commit immediately, tag it manually; this skill does not do that automatically.

This skill automates the flow with safeguards: backup refs for both branches, conflict triage, deferred publish gate, ask-before-cleanup.

Run `/merge-feature` from your feature branch. If you committed directly to the selected dev or prod branch (or have uncommitted changes there), the skill offers to **auto-extract** that work to a new feature branch and continue.

## How it works

**Preflight**:

- Before any git command, asks whether the target environment is **dev** or **prod**.
- From a feature branch: requires a clean working tree, captures the branch, proceeds.
- From a matching dev/prod target branch with local-only work (uncommitted changes, or commits ahead of `origin/$RELEASE_BRANCH`): offers **auto-extract** — creates a new feature branch holding the work, resets the target branch back to origin locally, then continues the normal flow.
- From a deployment branch belonging to the environment not selected: stops and asks the user to correct the environment choice or switch branches.
- From `main`/`master`: hard-stops (nothing for this skill to do).

**Target selection**: lists only local + remote branches for the chosen environment: `release/*` for dev or `prod/*` for prod. It never silently crosses environments.

**Sync from origin**: `git fetch origin --prune`, then ff-pull the selected target branch and, if pushed, the feature branch. Stops if either has diverged from its remote.

**Safety net**: tags + branches the pre-rebase feature state and the pre-merge target state. Both rollbacks are non-destructive.

**Rebase feature onto target**: replays feature commits on top of the selected target tip. Conflicts go through the triage protocol (trivial blocks auto-resolve with a one-line log; non-trivial blocks pause for your approval).

**Pre-merge validation**: `npm install` if manifests changed, then `npm run build:data-provider` + `npm run build`. Offers to roll back to pre-rebase state if validation can't be fixed.

**Merge**: `git checkout $RELEASE_BRANCH && git merge --no-ff $FEATURE_BRANCH`. Should be conflict-free (we just rebased); if conflicts appear anyway (origin race), triage runs again.

**Post-merge validation**: same build sequence on the selected target branch. Offers target-branch rollback if needed.

**Tag the merge commit**: parses the upstream version prefix from the selected dev/prod branch, finds the highest existing `v0.8.4-fdj<N>` tag across the repository, and proposes `<N+1>`. Asks for confirm / override / skip, then creates an annotated tag at the merge commit.

**Publish gate**: shows the selected target's delta and the new tag, asks for explicit approval before `git push`, then pushes branch and tag together. No force-push, ever.

**Cleanup**: asks whether to delete the feature branch (local + remote, local only, force-push the rebased version, or keep everything). Default recommendation: delete both.

**Summary**: what was merged, push status, cleanup status, backup refs for rollback, smoke-test reminders.

## Rollback

Two backup refs are created in Step 2 and printed in the summary:

- `pre-merge-feature-<hash>-<timestamp>` — feature branch's pre-rebase state. Reset with `git checkout $FEATURE_BRANCH && git reset --hard <backup-ref>` (only possible if you didn't delete the feature branch).
- `pre-merge-release-<hash>-<timestamp>` — selected target branch's pre-merge state. Reset with `git checkout $RELEASE_BRANCH && git reset --hard <backup-ref>`. If the target branch was already pushed, prefer a revert; rewriting the shared branch would require a destructive force-push.

Each backup also has a corresponding `backup/<name>` branch.

## Token usage

Same as `/update-librechat`: relies on git plumbing (`git status`, `git log`, `git diff`), opens only conflicted files during triage, no scanning of unrelated code.

---

# Goal

Integrate a feature branch into the user-selected dev or prod branch with the fewest surprises: select the environment first, rebase for clean history, validate twice, defer push to a single gate, and leave the user in control of cleanup.

# Operating principles

- The first interaction must ask **dev or prod**. Do not run git commands, infer from the current branch, or select a target before the user answers.
- Never merge into both environments in one invocation. Run the skill separately for each environment so each merge, validation, tag, and publish decision remains explicit.
- Never proceed with a dirty working tree.
- Backup both branches' refs before any rewrite.
- Default to MERGE `--no-ff` (preserves the feature-branch boundary in git log).
- Always rebase the feature branch onto the selected target tip, never the other way around.
- Never force-push or rename the selected dev/prod target branch. The branch is stable and tags accumulate.
- Force-pushing the feature branch is only acceptable if the user opts in explicitly (it's "your" branch but it may have reviewers tracking it).
- Ask before any `git push`, before any tag creation, and before any branch deletion.
- Annotated tags only (`git tag -a`), never lightweight — release tags carry tagger + date + message metadata.
- Keep token usage low: rely on git plumbing, open only conflicted files.

# Step -1: Choose the deployment environment

This must be the first interaction in every invocation. Before running any git command or inspecting the current branch, use AskUserQuestion:

- **Dev** (Recommended) — target a development branch under `release/`, canonically `release/v<X.Y.Z>-fdj<N>`. Existing `release/v<X.Y.Z>` branches remain valid for compatibility.
- **Prod** — target a production branch under `prod/`, canonically `prod/v<X.Y.Z>-fdj<N>`.

Do not infer the answer from the current branch, prior conversation, or branch availability. Wait for the answer, then set:

```bash
if [ "$DEPLOYMENT_ENV" = "dev" ]; then
  TARGET_ROOT="release"
  TARGET_REGEX='^release/v[0-9]+\.[0-9]+\.[0-9]+(-fdj[0-9]+)?$'
else
  TARGET_ROOT="prod"
  TARGET_REGEX='^prod/v[0-9]+\.[0-9]+\.[0-9]+-fdj[0-9]+$'
fi
```

The choice applies to target discovery, auto-extraction, merge, validation, tagging, publishing, rollback, and summary. Do not operate on the other environment during this invocation.

# Step 0: Preflight (and auto-extract if needed)

Capture the starting branch (before any branch operations):

- `START_BRANCH=$(git rev-parse --abbrev-ref HEAD)`

**Hard-stop on `main` or `master`** (nothing for this skill to do there):

- Tell the user: "This skill is for landing a feature into a dev or prod target branch. You're on `$START_BRANCH`. Either check out your feature branch, or check out the selected environment's target branch where you have work to extract, and re-run."
- Stop.

Fetch origin so we know what's published:

- `git fetch origin --prune`

If `START_BRANCH` starts with `release/` or `prod/` but does not match `$TARGET_REGEX`, stop. State whether it belongs to the unselected environment or has an invalid deployment-branch shape; never reinterpret it as a feature branch or silently switch environments.

**If `START_BRANCH` does NOT start with `release/` or `prod/`:**

- Normal case — user is on a feature branch.
- Standard preflight: if `git status --porcelain` is non-empty, tell the user to commit or stash first, then stop.
- Set `FEATURE_BRANCH=$START_BRANCH`. Proceed to Step 1.

**If `START_BRANCH` matches `$TARGET_REGEX`:**

Detect what local work exists that isn't yet on origin:

- `LOCAL_DIRTY=$([ -n "$(git status --porcelain)" ] && echo yes || echo no)` — uncommitted changes
- If `origin/$START_BRANCH` doesn't exist: stop with "Selected target branch `$START_BRANCH` is not on origin. Push it first (or pick a different target branch) — auto-extract requires a remote reference to reset to."
- Otherwise: `LOCAL_AHEAD=$(git rev-list --count origin/$START_BRANCH..HEAD)`

**Case A — nothing to extract** (`LOCAL_DIRTY=no` AND `LOCAL_AHEAD=0`):

- Tell the user: "You're on `$START_BRANCH` with no uncommitted changes and nothing ahead of origin. This skill needs work to land. Either switch to your feature branch, or make some changes here and re-run."
- Stop.

**Case B — local work present** (`LOCAL_DIRTY=yes` OR `LOCAL_AHEAD>0`):

Show the user what will be extracted:

- If `LOCAL_AHEAD>0`: `git log --oneline origin/$START_BRANCH..HEAD`
- If `LOCAL_DIRTY=yes`: `git status --short`

Explain the plan in one sentence: move this work onto a new feature branch, reset `$START_BRANCH` back to `origin/$START_BRANCH` locally (no force-push), then run the normal rebase-merge-tag flow targeting `$START_BRANCH`.

Use AskUserQuestion:

- **Extract to a new feature branch and continue** (Recommended)
- **Abort** — leave everything as-is, you'll handle it manually

If Abort: stop.

If Extract: continue with Step 0.5.

## Step 0.5: Extract work to a new feature branch

1. **Pick a name for the new feature branch.** Suggest a default derived from the work:
   - If `LOCAL_AHEAD>0`: parse the most recent commit's subject. Example: `fix(AttachFileMenu): dedup handleSmartUpload` → suggest `fix/attachfilemenu-dedup-handlesmartupload`.
   - If only uncommitted changes: suggest `chore/release-fixes-$(date +%Y%m%d)`.

   Ask the user via AskUserQuestion (or free-text) to accept the suggestion or override. Validate:
   - Must not be `main`, `master`, or start with `release/` or `prod/`
   - Must not exist locally: `git rev-parse --verify "refs/heads/$NAME" 2>/dev/null` fails
   - Must not exist on origin: `git ls-remote --exit-code --heads origin "$NAME"` fails
   - Re-prompt on validation failure.

2. **Show the final plan and confirm:**

   ```
   Plan:
     1. Stash uncommitted changes (if any)
     2. Create new branch $NEW_FEAT pointing at current HEAD ($LOCAL_AHEAD commits ride along)
     3. Reset $START_BRANCH back to origin/$START_BRANCH (local-only — no push)
     4. Switch to $NEW_FEAT
     5. Unstash onto $NEW_FEAT
     6. Have you commit any remaining uncommitted changes
   After extract:
     - $NEW_FEAT holds your work
     - $START_BRANCH (local) matches origin/$START_BRANCH — no force-push needed
     - Skill continues with RELEASE_BRANCH=$START_BRANCH and FEATURE_BRANCH=$NEW_FEAT
   ```

   AskUserQuestion: **Proceed** / **Abort**. If Abort: stop, nothing has been changed yet.

3. **Execute the extract** (each command is locally reversible if the next fails):
   - If `LOCAL_DIRTY=yes`: `git stash push -m "auto-extract-from-$START_BRANCH-$(date +%s)"`
   - `git branch "$NEW_FEAT"` — pins new branch at the original HEAD (includes the local commits)
   - `git reset --hard "origin/$START_BRANCH"` — selected target branch now matches remote
   - `git checkout "$NEW_FEAT"` — working tree now reflects the original HEAD
   - If we stashed: `git stash pop` — restores uncommitted changes (conflict-free: the stash was taken at the same commit `$NEW_FEAT` now points to)

4. **Handle any newly-uncommitted changes** (from the unstash):
   - If `git status --porcelain` is empty: nothing to do.
   - Otherwise use AskUserQuestion:
     - **Auto-commit with a generated message** (Recommended) — `git add -A && git commit -m "wip: extracted changes from $START_BRANCH"`. You can `git commit --amend` later if you want to refine the message.
     - **Open my editor for the commit message** — `git add -A && git commit` (uses `$GIT_EDITOR`).
     - **Stop here — I'll commit manually and re-run** — extract has succeeded; the skill exits cleanly. Re-running on `$NEW_FEAT` will pick up from Step 1.

5. Set `FEATURE_BRANCH=$NEW_FEAT` and `RELEASE_BRANCH=$START_BRANCH`. Here `RELEASE_BRANCH` means the selected dev/prod target for compatibility with the remaining steps. Proceed to Step 1, which skips target selection.

# Step 1: Pick the target branch for the selected environment

**If `RELEASE_BRANCH` is already set from Step 0.5 auto-extract**: skip the selection below; the target is `$RELEASE_BRANCH`. Proceed directly to Step 2.

Otherwise, enumerate candidates only under `$TARGET_ROOT`:

```bash
{
  git for-each-ref --format='%(refname:short)' "refs/heads/$TARGET_ROOT/"
  git ls-remote --heads origin "refs/heads/$TARGET_ROOT/*" | awk '{print $2}' | sed 's|refs/heads/||'
} | grep -E "$TARGET_REGEX" | sort -u -V -r
```

(`sort -V -r` = version sort, newest first; `-u` deduplicates local-and-remote entries.)

Branch handling:

- **Zero matches**: ask the user to name the target. Validate it against `$TARGET_REGEX`. If it does not exist locally or on origin, stop — creating deployment branches belongs to `/update-librechat`.
- **Exactly one match**: auto-select it, tell the user.
- **2 or more matches**: use AskUserQuestion with the top 3 newest as options (newest = Recommended). User can also pick "Other" to enter a name manually.

Store the choice as `RELEASE_BRANCH` for compatibility with the remaining workflow, and state `$DEPLOYMENT_ENV` alongside it. Reject any choice that does not match `$TARGET_REGEX`, even if the branch exists. This is the guard that prevents a dev choice from landing on prod or vice versa.

Make sure `RELEASE_BRANCH` exists locally as a tracking branch (so we can check it out and ff-pull):

- If it exists locally: nothing to do.
- If it only exists on origin: `git fetch origin "$RELEASE_BRANCH:$RELEASE_BRANCH"` to create the local tracking branch.
- If it only exists locally: warn the user — the post-merge push will create a new remote ref. Continue.

Refuse if `RELEASE_BRANCH == FEATURE_BRANCH`. Also verify once more that it matches `$TARGET_REGEX` before creating backup refs.

# Step 2: Safety net

Capture pre-state for both branches.

```
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
FEATURE_HASH=$(git rev-parse --short "$FEATURE_BRANCH")
RELEASE_HASH=$(git rev-parse --short "$RELEASE_BRANCH")

FEATURE_BACKUP="pre-merge-feature-$FEATURE_HASH-$TIMESTAMP"
RELEASE_BACKUP="pre-merge-release-$RELEASE_HASH-$TIMESTAMP"

git tag    "$FEATURE_BACKUP"        "$FEATURE_BRANCH"
git branch "backup/$FEATURE_BACKUP" "$FEATURE_BRANCH"
git tag    "$RELEASE_BACKUP"        "$RELEASE_BRANCH"
git branch "backup/$RELEASE_BACKUP" "$RELEASE_BRANCH"
```

Save `$FEATURE_BACKUP`, `$RELEASE_BACKUP`, `$FEATURE_HASH`, `$RELEASE_HASH` for the summary.

# Step 3: Sync the selected target branch from origin

- `git checkout "$RELEASE_BRANCH"`
- If a remote tracking branch exists:
  - `git pull --ff-only origin "$RELEASE_BRANCH"`
  - If non-fast-forward: stop. The local target branch has diverged from origin. Tell the user to reconcile manually before re-running.

# Step 4: Sync feature branch from origin (if pushed)

- `git checkout "$FEATURE_BRANCH"`

Check whether the feature branch is on origin:

- `git ls-remote --exit-code --heads origin "$FEATURE_BRANCH"` — exit 0 means yes.

If yes:

- `FEATURE_PUSHED=yes`
- `git pull --ff-only origin "$FEATURE_BRANCH"`
- If non-fast-forward (someone force-pushed it, or you have unpushed commits): warn the user. Use AskUserQuestion: **Abort** / **Proceed with local state** (your commits, possibly losing whatever's on origin during cleanup) / **Reset to origin state**.

If no:

- `FEATURE_PUSHED=no`
- Skip — the feature branch lives only locally. After the merge we won't push it; cleanup will just delete the local ref.

Record `FEATURE_PUSHED` for Step 11's cleanup logic.

# Step 5: Rebase feature onto the selected target tip

Show the user what's about to happen:

- `AHEAD=$(git rev-list --count "$RELEASE_BRANCH..$FEATURE_BRANCH")` — feature commits being rebased.
- `BEHIND=$(git rev-list --count "$FEATURE_BRANCH..$RELEASE_BRANCH")` — release commits the feature is behind.

If `BEHIND == 0`: the feature branch is already on the selected target tip. Skip the rebase, say so, and jump to Step 6.

Otherwise:

- `git rebase "$RELEASE_BRANCH"`

If conflicts at any commit: follow the **Conflict triage protocol** below. After each commit's conflicts are resolved and staged, `git rebase --continue`. If git reports "no changes" (your commit's effect is already in the release), `git rebase --skip` and log a one-liner noting which commit was skipped as already-applied.

If the rebase gets unwieldy (>3 rounds of conflicts on the same file, or the user wants out):

- `git rebase --abort` — feature branch returns to its pre-rebase state automatically.
- Suggest the user split the feature into smaller commits or rebase in their editor with `git mergetool`, then re-run this skill.

After a successful rebase, the feature branch sits on top of the selected target tip with linear history. **Its commit hashes have changed.** If `FEATURE_PUSHED=yes`, the local feature branch now diverges from `origin/$FEATURE_BRANCH` — handled in Step 11.

# Conflict triage protocol (used by Steps 5 and 7)

Whenever `git rebase` or `git merge` produces a conflict, follow this protocol per conflicted file. **Default to non-trivial when in doubt** — over-asking is cheap; silently landing a wrong resolution on a dev or prod branch is not.

## A. Enumerate conflicts

- `git status --short` to list conflicted files (marked `UU`, `AA`, `DD`, `AU`, `UA`, etc.)
- For each file, count blocks: `grep -c '^<<<<<<<' <file>` — this is how many marker pairs need a decision.

## B. Special case — lockfile conflicts

If `package-lock.json` is conflicted, **do not edit markers**. Instead:

- Resolve any `package.json` conflicts first (per protocol below), stage them.
- `rm package-lock.json && npm install` to regenerate from the merged manifests.
- `git add package-lock.json`

## C. Classify each conflict block

**Trivial — auto-resolve, log a one-line note, do not interrupt the user:**

- Whitespace-only differences
- Import statement reordering (no new imports added, none removed)
- Version string bumps in `package.json`
- Comment-only or JSDoc-only differences
- Pure formatting changes already covered by Prettier/ESLint

For each trivial block: apply the resolution, log a one-liner like `[trivial] api/server/routes/mcp.js:42 — import reorder, kept local`.

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
2. Show the proposed resolution side-by-side — usually a merge of both sides — and annotate which lines come from each side and which are new.
3. State briefly what intent is being preserved on each side.
4. Use AskUserQuestion:
   - **Apply proposed resolution** (Recommended)
   - **Keep feature side only** (the commit being rebased / the merging branch)
   - **Keep target side only** (existing dev/prod branch code)
   - **Skip — I'll resolve manually**

5. Apply the chosen action. If "Skip," do not stage the file yet — note the path; pause the skill at the end of this commit's triage until the user has cleaned markers and run `git add` themselves.

If a single file has many non-trivial blocks (>5), offer a bulk choice up front: "Ask per-block" vs "Open the file in my IDE, I'll resolve it whole."

## E. Stage and continue

- After every block in a file is resolved (no markers remain), `git add <file>`.
- After every file is processed: `git diff --check` should show no remaining conflict markers.
- If any files were skipped, **pause the skill** and wait — print the list of paths needing manual resolution.
- When all conflicted files are staged, complete the in-flight operation:
  - rebase: `git rebase --continue`
  - merge: `git commit --no-edit`

# Step 6: Validate the rebased feature branch

If `package.json` or `package-lock.json` changed during the rebase, use AskUserQuestion:

- **Run `npm install` now** (Recommended) — sync `node_modules` with the rebased lockfile.
- **Skip** — proceed to validation with current `node_modules` (may fail with module-not-found errors).

Then run, in order:

- `npm run build:data-provider`
- `npm run build`

If either build fails: show the error and only fix issues clearly caused by the rebase (missing imports, type mismatches from merged code). Do not refactor unrelated code. If unclear, ask the user.

If validation is broken and you cannot pinpoint a fix in a few attempts, **stop and offer rollback**:

- `git checkout "$FEATURE_BRANCH" && git reset --hard "$FEATURE_BACKUP"` returns the feature branch to its pre-rebase state. The selected target branch is untouched.
- Suggest the user investigate the conflict resolutions, then re-run this skill.

# Step 7: Merge feature into the selected target branch

Switch to the selected target branch:

- `git checkout "$RELEASE_BRANCH"`

Paranoia check — origin might have moved during the rebase/validation:

- `git fetch origin "$RELEASE_BRANCH"`
- `BEHIND_ORIGIN=$(git rev-list --count "$RELEASE_BRANCH..origin/$RELEASE_BRANCH" 2>/dev/null || echo 0)`
- If `BEHIND_ORIGIN > 0`: tell the user origin/$RELEASE_BRANCH advanced during the run. Use AskUserQuestion: **Abort and re-run** / **ff-pull and continue** (rebase the feature on top of the new target tip first — the skill loops back to Step 5).

Merge with `--no-ff`:

- `git merge --no-ff "$FEATURE_BRANCH" -m "Merge branch '$FEATURE_BRANCH' into $RELEASE_BRANCH"`

This should be conflict-free because the feature was rebased onto the target tip. If conflicts do appear because of a race or missed change:

- Follow the **Conflict triage protocol** above.
- After resolving: `git commit --no-edit` to finalize the merge commit.

# Step 8: Validate the selected target branch post-merge

If `package.json` or `package-lock.json` changed since the pre-merge state (`$RELEASE_BACKUP..HEAD`), ask whether to run `npm install` (same prompt as Step 6).

Then run:

- `npm run build:data-provider`
- `npm run build`

If broken: offer rollback.

- `git checkout "$RELEASE_BRANCH" && git reset --hard "$RELEASE_BACKUP"` returns the target branch to its pre-merge state. The rebased feature branch remains available for a retry.

# Step 9: Create the deployment tag

Parse the upstream version prefix from the selected dev/prod branch. Accept dev forms `release/v0.8.4-fdj11` and legacy `release/v0.8.4`, plus prod form `prod/v0.8.4-fdj11`:

```
if [[ "$RELEASE_BRANCH" =~ ^(release|prod)/(v[0-9]+\.[0-9]+\.[0-9]+)(-fdj[0-9]+)?$ ]]; then
  TAG_PREFIX="${BASH_REMATCH[2]}"   # e.g. v0.8.4
else
  # Unknown branch shape — ask the user for the tag prefix.
fi
```

If the regex doesn't match: ask the user for the tag prefix (e.g. they type `v0.8.4`). Validate it has the `v<X.Y.Z>` shape.

Compute the next fdj number from existing tags:

```
LATEST=$(git tag --list "${TAG_PREFIX}-fdj*" --sort=-v:refname | head -1)
if [ -z "$LATEST" ]; then
  NEXT_N=1
else
  CURRENT_N=$(echo "$LATEST" | sed "s|^${TAG_PREFIX}-fdj||")
  NEXT_N=$((CURRENT_N + 1))
fi
NEW_TAG="${TAG_PREFIX}-fdj${NEXT_N}"
```

Verify `$NEW_TAG` doesn't already exist (would only happen if someone tagged during the run):

- `git rev-parse --verify "refs/tags/$NEW_TAG" 2>/dev/null` — if it exists, bump again until clear, or ask the user.

Also verify it doesn't exist on origin:

- `git ls-remote --exit-code --tags origin "$NEW_TAG"` — if it exists, refuse to overwrite (we never force-update a tag). Ask the user to bump manually.

Show the user:

```
Environment:       $DEPLOYMENT_ENV
Target branch:     $RELEASE_BRANCH
Tag prefix:        $TAG_PREFIX
Latest existing:   $LATEST    (or "none" if first tag in series)
Next tag:          $NEW_TAG   ← will be created on merge commit $(git rev-parse --short HEAD)
```

Use AskUserQuestion:

- **Create tag `$NEW_TAG`** (Recommended)
- **Override the number** — e.g. skip ahead to `-fdj20` for an out-of-band release. User types the new tag; validate against existing tags on both local and origin.
- **Skip — no tag for this merge** — useful for WIP / non-release merges.

If Create or Override:

- `git tag -a "$NEW_TAG" -m "Release $NEW_TAG — merged $FEATURE_BRANCH into $RELEASE_BRANCH" HEAD`

Record `$NEW_TAG` (or "none" if skipped) for the publish gate and summary.

# Step 10: Publish gate (push selected branch + tag)

This is the only place where the skill pushes to a shared remote.

Show what's about to be pushed:

```
Environment:      $DEPLOYMENT_ENV
$RELEASE_BRANCH:  $RELEASE_HASH → $(git rev-parse --short "$RELEASE_BRANCH")  (validated locally)
                  +1 merge commit from $FEATURE_BRANCH (rebased onto target tip)
                  +$AHEAD feature commits
Tag $NEW_TAG:     points at the merge commit                                  (or "no tag created" if skipped)
```

Final paranoia check before push:

- `git fetch origin "$RELEASE_BRANCH"`
- If origin advanced again during validation/tagging: tell the user and ask whether to abort, ff-pull, or push anyway (the last only valid if local is strictly ahead of origin after the fetch).

Use AskUserQuestion:

- **Push branch + tag** (Recommended, if tag was created) — pushes `$RELEASE_BRANCH` and `$NEW_TAG`
- **Push branch only** — leave tag local for review or amendment
- **Skip — I'll push manually**

If pushing branch: `git push origin "$RELEASE_BRANCH"`.

- If push fails (remote moved, hook rejected, branch protection): surface the error. Do NOT auto-rebase or force-push. Suggest manual reconciliation.

If pushing tag (only if `$NEW_TAG` was created): `git push origin "$NEW_TAG"`.

- If push fails: surface the error. Never `--force` a tag push.

Record what was pushed for the summary.

# Step 11: Cleanup — feature branch

Use AskUserQuestion based on `FEATURE_PUSHED`.

**If `FEATURE_PUSHED=yes`:**

- **Delete local + remote** (Recommended) — feature is merged, no longer needed.
  - `git branch -D "$FEATURE_BRANCH"`
  - `git push origin --delete "$FEATURE_BRANCH"`
- **Force-push the rebased version** — keep the feature branch around at its new (rebased) tip.
  - `git push --force-with-lease origin "$FEATURE_BRANCH"`
  - Local branch stays.
- **Delete remote only, keep local** — `git push origin --delete "$FEATURE_BRANCH"`. The (rebased) local branch stays.
- **Leave everything as-is** — local feature branch sits at its rebased state; remote feature branch still has pre-rebase hashes. You handle it later.

**If `FEATURE_PUSHED=no`:**

- **Delete local feature branch** (Recommended) — `git branch -D "$FEATURE_BRANCH"`.
- **Keep local feature branch** — useful if you want to retry, compare, or branch from it.

Record what was done for the summary.

# Step 12: Summary

Show:

- Deployment environment: `$DEPLOYMENT_ENV`
- Feature branch: `$FEATURE_BRANCH` — _deleted (local + remote)_ / _deleted local only_ / _kept (force-pushed)_ / _kept as-is_
- Target branch: `$RELEASE_BRANCH`, `$RELEASE_HASH` → `$(git rev-parse --short "$RELEASE_BRANCH")`, pushed to origin: **yes / no**
- Deployment tag: `$NEW_TAG` (or "none — tag was skipped"), pushed to origin: **yes / no**
- Feature commits merged: `$AHEAD` (rebased, then merged via `--no-ff`)
- Conflicts resolved during rebase (list files, if any)
- Conflicts resolved during merge (list files, if any — should be none under normal flow)
- Backup refs (for rollback):
  - `$FEATURE_BACKUP` — feature pre-rebase state (also `backup/$FEATURE_BACKUP`)
  - `$RELEASE_BACKUP` — release pre-merge state (also `backup/$RELEASE_BACKUP`)

If anything was NOT pushed in Step 10, show the manual commands:

- `git push origin $RELEASE_BRANCH`
- `git push origin $NEW_TAG` (if tag was created locally)

Recommended next steps:

1. `npm run backend` + `npm run frontend:dev` — smoke-test the merged feature end-to-end.
2. If you skipped pushing branch/tag: push when ready.
3. If you skipped feature-branch cleanup: handle it when ready.

Rollback paths:

- Roll back the target branch (not pushed): `git checkout "$RELEASE_BRANCH" && git reset --hard "$RELEASE_BACKUP"`. Also delete the local tag if created: `git tag -d $NEW_TAG`.
- Roll back the target branch (pushed): prefer a revert. Resetting would require a destructive force-push; do not do it without separate explicit approval. If the tag was also pushed, deleting it also requires separate explicit approval.
- Roll back feature branch rebase: `git checkout "$FEATURE_BRANCH" && git reset --hard "$FEATURE_BACKUP"` (only possible if you didn't delete the feature branch in Step 11).
