# Agent-Scoped Consume-Only Skills

Status: implementation proposal

Related issue: https://github.com/danny-avila/LibreChat/issues/14628

## Objective

Make Skills explicitly attached to a persisted agent automatically available whenever an
authorized user invokes that agent. The user must not need the Skill to be separately shared
or activated in their Skill Library.

The behavior should match the existing MCP server model: access to an agent grants a
run-scoped, consume-only capability for resources attached to that agent. It must not grant
normal library, view, edit, download, or out-of-agent access to the Skill.

## Current Behavior

1. Agent initialization obtains Skill IDs the current user can directly VIEW through the
   Skill ACL.
2. `resolveAgentScopedSkillIds` intersects that set with `agent.skills` when the agent has a
   non-empty allowlist.
3. `resolveSkillActive` applies the current user's `skillStates` and
   `defaultActiveOnShare` setting.
4. Consequently, an attached Skill is unavailable when the agent recipient either lacks
   direct Skill VIEW access or has not activated the shared Skill.

The existing agent read APIs already provide useful confidentiality boundaries:

- VIEW-only `GET /agents/:id` responses contain basic metadata rather than the full agent
  configuration.
- Agent-list responses sanitize `skills` for viewers without direct Skill access.
- The Skill Library lists Skills through direct Skill ACL access.

Preserve those boundaries.

## Terminology

- **Direct Skill**: the current user has direct Skill VIEW permission, or the Skill is a
  deployment Skill.
- **Required Skill**: a Skill explicitly referenced by `agent.skills` while
  `agent.skills_enabled === true`.
- **Delegated Skill**: a required Skill the user can consume only because they can invoke
  the current agent. The user does not have direct Skill VIEW permission.
- **Optional Skill**: a directly accessible Skill included through the user's ordinary
  active Skill catalog.
- **Effective Skill**: a required or optional Skill authorized for the current agent run.

## Required Product Semantics

For a persisted agent with `skills_enabled === true` and a non-empty `skills` array:

1. Every existing referenced Skill is required for that agent.
2. Required Skills are active for the run regardless of the recipient's `skillStates` and
   regardless of `interface.skills.defaultActiveOnShare`.
3. Required Skills are available only while invoking that specific agent or one of its
   independently authorized subagents that references the same Skill.
4. Required Skills do not appear in the recipient's Skill Library unless separately shared.
5. Required Skills cannot be fetched, edited, shared, downloaded, or invoked outside the
   agent through delegated access.
6. Removing the recipient's agent access removes delegated Skill access immediately.
7. Direct Skill access takes precedence over delegated access for UI and management, but
   the Skill remains required and active inside the agent.

The recipient must still have:

- VIEW access to the persisted agent, or the corresponding REMOTE_AGENT permission at a
  remote API entry point.
- The role-level `SKILLS.USE` permission.
- Access to any underlying execution capability required by the Skill. A Skill must not
  elevate `execute_code`, MCP, file, or other tool permissions beyond existing checks.

Use the phrase **effective for this agent run** in code and UI descriptions. Do not persist
an activation entry into the recipient's `user.skillStates` map.

## Agent Configuration

Reuse the existing fields:

```ts
skills_enabled?: boolean;
skills?: string[];
```

Add one optional field:

```ts
allow_other_skills?: boolean;
```

Its meaning is:

- `false`: only required Skills attached to the agent are available.
- `true`: required Skills plus the current user's other directly accessible, active Skills
  are available.

Backward-compatible default:

```ts
const allowOtherSkills =
  agent.allow_other_skills ??
  (!Array.isArray(agent.skills) || agent.skills.length === 0);
```

Implement the expression with clear parentheses or a helper. The intended compatibility is:

- Existing enabled agent with selected Skills: preserve selected-only scope.
- Existing enabled agent with no selected Skills: preserve the full directly accessible,
  active user catalog.
- Disabled agent: no Skills, regardless of either field.

Do not add a database migration. Mongoose's optional field and the runtime fallback are
sufficient.

Ephemeral agents and model specifications do not receive delegated access because they are
not persisted, shareable agent resources. They continue to resolve only directly accessible
Skills.

## Runtime Authorization Model

Do not merge delegated Skill IDs into the user's global ACL-derived Skill set. Delegation
must remain request-scoped and agent-scoped.

Replace the current flat scoping result with a structure that preserves provenance. Naming
may vary, but it should be equivalent to:

```ts
interface AgentSkillScope {
  requiredSkillIds: Types.ObjectId[];
  optionalSkillIds: Types.ObjectId[];
  effectiveSkillIds: Types.ObjectId[];
  requiredSkillIdSet: Set<string>;
}
```

Resolve it as follows:

```ts
if (!skillsCapabilityEnabled || agent.skills_enabled !== true) {
  return emptyScope;
}

const selectedRefs = uniqueStrings(agent.skills ?? []);
const { validIds: selectedIds, invalidRefs } = partitionValidObjectIds(selectedRefs);
const existingSelectedIds = await findExistingSkillIdsForTenant(selectedIds, requestTenantId);
const existingSelectedIdSet = new Set(existingSelectedIds.map((id) => id.toString()));
const missingRequiredRefs = invalidRefs.concat(
  selectedIds
    .filter((id) => !existingSelectedIdSet.has(id.toString()))
    .map((id) => id.toString()),
);
const requiredSkillIds = isPersistedAndAuthorizedAgent ? existingSelectedIds : [];
const requiredSkillIdSet = new Set(requiredSkillIds.map((id) => id.toString()));
const optionalSkillIds = allowOtherSkills
  ? directAccessibleSkillIds.filter((id) => !requiredSkillIdSet.has(id.toString()))
  : [];
const effectiveSkillIds = unique(requiredSkillIds.concat(optionalSkillIds));
```

Important constraints:

- Verify selected IDs in one batched database query. Do not perform one query per Skill.
- Use the existing tenant-aware Skill data layer. A persisted ObjectId must never allow a
  cross-tenant Skill lookup.
- Never accept arbitrary request-body Skill IDs as delegated. Use the persisted agent
  document loaded after agent authorization.
- For normal agent chat, delegated scope is valid only after AGENT VIEW authorization.
- For OpenAI-compatible and Responses entry points, use the existing REMOTE_AGENT access
  boundary.
- For subagents, calculate a separate scope only after that subagent passes discovery access
  validation. Never inherit the parent agent's required Skill IDs.
- Deployment Skills retain their existing behavior.

## Activation Rules

Update activation resolution to understand required Skills:

```ts
if (requiredSkillIdSet.has(skillId.toString())) {
  return true;
}
return resolveExistingUserActivationRules(...);
```

Required status must take precedence over:

- `skillStates[skillId] === false`
- ownership defaults
- `defaultActiveOnShare === false`

Apply the same rule consistently to:

- model-visible catalog injection
- model-invoked Skill lookup
- manual Skill invocation
- `always-apply` resolution
- Skill file lookup and `read_file`
- allowed-tools collection from manually primed and always-applied Skills

After activation filtering, runtime handlers must receive only the effective IDs for the
current agent. Do not expose delegated IDs through user settings or general Skill APIs.

`always-apply` remains independent: attachment controls whether a Skill is available;
`always-apply` controls whether its body is primed automatically on every turn.

## Attachment Authorization

Because attachment now delegates consumption to agent recipients, adding a Skill is a
sharing action rather than a simple allowlist edit.

Required backend validation:

1. On agent create or update, validate every newly added Skill ID.
2. The editor must have direct `PermissionBits.SHARE` access to each newly attached Skill.
3. Existing retained IDs may remain during unrelated edits, following the established MCP
   tool update pattern. Removing an inaccessible attachment must always be allowed.
4. Agent duplication and version reversion create a new effective attachment set and must
   revalidate the resulting IDs.
5. Reject unauthorized additions with HTTP 403 and a stable error code such as
   `AGENT_SKILL_DELEGATION_FORBIDDEN`.
6. Continue rejecting malformed or nonexistent IDs with HTTP 400.
7. Apply the existing tenant boundary to attachment validation and return the same forbidden
   or unavailable result used for other inaccessible resources.

For public agent sharing, additionally require the caller's role-level Skill public-sharing
permission. Do not create Skill ACL entries for recipients; the authorization is derived
from agent access at runtime.

The Skill picker should show only Skills the editor can validly attach, or clearly disable
Skills lacking SHARE permission. Backend validation remains authoritative.

## API And UI Visibility

Delegated access must not alter existing Skill endpoints:

- `GET /api/skills` remains based on direct Skill ACL access.
- `GET /api/skills/:id`, tree, files, edit, delete, and share endpoints remain based on
  direct Skill permissions.
- User Skill state endpoints must reject delegated-only IDs and must not persist them.

For an agent viewer without direct Skill access:

- Return the normal basic agent metadata needed to select and invoke the agent.
- Do not return attached Skill IDs, names, bodies, file trees, or `allow_other_skills`.
- Do not expose full Agent Builder configuration.

For an agent editor:

- Label the selected list **Required Skills**.
- Explain that these Skills are available automatically whenever the agent is used.
- Add a checkbox labeled **Allow users' other active Skills** bound to
  `allow_other_skills`.
- Preserve unresolved attachment rows so an editor can remove broken dependencies.

Only add English localization keys. Follow the repository's localization workflow for other
languages.

## Failure Behavior

Do not silently run an agent with missing required dependencies.

Before calling the model, fail with a structured error when:

- a required Skill document no longer exists
- global agent Skill capability is disabled
- the recipient lacks the role-level `SKILLS.USE` permission
- required Skill initialization fails before the model request

Use an error shape equivalent to:

```json
{
  "code": "AGENT_SKILL_DEPENDENCY_MISSING",
  "agent_id": "agent_...",
  "missing_count": 1
}
```

Do not reveal names or IDs of delegated-only Skills to VIEW-only users. Full details may be
logged server-side and returned to authorized agent editors.

Deletion cleanup may continue pruning Skill IDs from agents, but it must not accidentally
widen an empty allowlist into the full optional catalog. Preserve the existing fail-closed
behavior when pruning removes the final selected Skill.

## Security Boundary

Consume-only means hidden from management and library APIs; it does not mean the Skill is a
confidential secret. Skill instructions and files are supplied to the model or execution
environment and may be inferred or reproduced in outputs.

Document this limitation. Never place credentials or secrets in a Skill body or Skill file.
Any Skill execution must run with the recipient's request context and permissions, never the
agent creator's credentials.

## Expected Implementation Areas

At minimum, inspect and update these areas:

- `packages/data-provider/src/types/assistants.ts`
- `packages/data-provider/src/schemas.ts`
- `packages/data-schemas/src/schema/agent.ts`
- `packages/data-schemas/src/types/agent.ts`
- `packages/api/src/agents/validation.ts`
- `packages/api/src/agents/skills.ts`
- `packages/api/src/agents/initialize.ts`
- `packages/api/src/agents/discovery.ts`
- `api/server/services/Endpoints/agents/initialize.js`
- `api/server/controllers/agents/openai.js`
- `api/server/controllers/agents/responses.js`
- `api/server/controllers/agents/v1.js`
- `client/src/components/SidePanel/Agents/AgentConfig.tsx`
- `client/src/locales/en/translation.json`

Keep legacy `/api` changes thin where possible and place reusable new backend logic in
`packages/api` or `packages/data-schemas`.

## Engineering Constraints

- Read the current worktree before editing and preserve unrelated user changes.
- Reuse existing permission, tenant, agent-discovery, and Skill data-layer helpers rather
  than introducing parallel authorization logic.
- Keep new backend implementation in TypeScript under `packages/api` or
  `packages/data-schemas`; use legacy JavaScript only for thin entry-point wiring.
- Do not use `any`, dynamic imports, per-Skill database loops, or broad untyped records.
- Keep delegated IDs in request-scoped structures. Do not cache them as user-level access.
- Add short comments only where the permission boundary is not self-explanatory.

## Required Tests

### Scope And Activation Unit Tests

1. Disabled agent produces an empty scope.
2. Existing enabled agent with no selected Skills retains the directly accessible active
   catalog.
3. Existing enabled agent with selected Skills defaults to selected-only scope.
4. `allow_other_skills: true` unions required and directly accessible optional Skills.
5. Required and optional overlap is deduplicated, with required status winning.
6. Required Skill remains active when `skillStates[id]` is false.
7. Optional Skill remains governed by `skillStates` and `defaultActiveOnShare`.
8. Ephemeral agents never obtain delegated Skill IDs.
9. Each subagent receives only its own required Skill set.

### Authorization Integration Tests

1. User A owns a Skill and an agent containing it.
2. User A shares only the agent with User B as VIEW-only.
3. User B cannot list or fetch the Skill through Skill APIs.
4. User B can invoke the agent and the attached Skill is catalogued and executable.
5. User B's personal inactive state does not disable the required Skill in that agent.
6. User B cannot invoke the Skill in a direct-model chat or another agent.
7. Removing User B's agent access removes delegated Skill execution.
8. A user lacking `SKILLS.USE` cannot receive delegated execution.
9. A user with Skill VIEW but without Skill SHARE cannot newly attach that Skill to a
   delegating agent.
10. A public agent delegates only after public-sharing checks pass.
11. OpenAI-compatible, Responses, normal chat, and subagent entry points behave identically.

### Runtime Tests

1. Model invocation resolves a required Skill.
2. Manual invocation resolves a required user-invocable Skill only inside the agent.
3. Required `always-apply` Skills are primed even when personally inactive.
4. Delegated Skill files are readable by runtime tools only for the current agent run.
5. Skill `allowed-tools` does not bypass recipient role or endpoint capability checks.
6. Missing required dependencies fail before the provider request with a structured error.
7. Viewer agent responses do not leak attached Skill IDs or configuration.

Use real permission and database logic where practical. Avoid tests that prove only mocked
return values.

## Non-Goals

- Persistently activating delegated Skills in the recipient's Skill Library.
- Automatically creating direct Skill ACL entries when an agent is shared.
- Allowing delegated Skill editing, downloading, duplication, or sharing.
- Delegating Skills through ephemeral agents or model specifications.
- Guaranteeing Skill source confidentiality from a user who can execute the agent.
- Pinning a specific Skill content version. Version pinning can be proposed separately.

## Acceptance Criteria

The implementation is complete when all of the following hold:

1. Sharing only an agent is sufficient for its VIEW-only recipient to execute every valid
   attached required Skill.
2. The recipient performs no Skill Library activation step.
3. Delegated Skills remain absent from the recipient's Skill Library and management APIs.
4. Delegated access works only in the authorized agent run and disappears when agent access
   is removed.
5. Selected Skills are consistently active across catalog, manual, always-apply, file, and
   subagent paths.
6. Other user Skills are included only when `allow_other_skills` is true.
7. New attachments are permission-validated and cannot be created using arbitrary Skill IDs.
8. Missing dependencies fail explicitly rather than silently degrading the agent.
9. Existing agents with empty or selected Skill scopes retain their previous catalog breadth
   through the compatibility default.
10. Targeted unit and integration suites pass, and the data-provider and affected packages
    build without TypeScript or ESLint errors.

## Verification And Handoff

The implementing agent must:

1. Run the focused agent Skill, initialization, agent-controller, Skill data-layer, and
   frontend component tests affected by the change.
2. Run `npm run build:data-provider` after shared schemas or types change.
3. Run the relevant package TypeScript builds and ESLint checks for every touched file.
4. Report every command run and its result. If a test cannot run, state the exact blocker.
5. Provide a final list of touched files and call out any intentional deviation from this
   proposal before requesting review.
