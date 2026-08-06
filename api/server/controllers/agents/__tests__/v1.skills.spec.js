/**
 * Focused tests for agent-scoped Skills authorization in v1.js handlers.
 *
 * Covers:
 * - Private agents: attaching skills requires only SHARE per skill (not SHARE_PUBLIC)
 * - Public agents: attaching skills additionally requires SKILLS.SHARE_PUBLIC
 * - MAX_AGENT_SKILLS (100) hard limit on update
 * - Revert handler: 150-skill legacy snapshot is capped to 100 atomically
 */

const mockFindAccessibleResources = jest.fn().mockResolvedValue([]);
const mockFindEntriesByPrincipalsAndResource = jest.fn().mockResolvedValue([]);
const mockGrantPermission = jest.fn().mockResolvedValue({});
const mockHasPublicPermission = jest.fn().mockResolvedValue(false);
const mockFindPubliclyAccessibleResources = jest.fn().mockResolvedValue([]);
const mockGetResourcePermissionsMap = jest.fn().mockResolvedValue(new Map());
const mockGetAgent = jest.fn();
const mockUpdateAgent = jest.fn();
const mockRevertAgentVersion = jest.fn();
const mockFindExistingSkillIdsForTenant = jest.fn().mockResolvedValue([]);
const mockCanShareSkillsPublicly = jest.fn().mockResolvedValue(true);

jest.mock('~/server/services/PermissionService', () => ({
  findAccessibleResources: (...args) => mockFindAccessibleResources(...args),
  findPubliclyAccessibleResources: (...args) => mockFindPubliclyAccessibleResources(...args),
  getResourcePermissionsMap: (...args) => mockGetResourcePermissionsMap(...args),
  hasPublicPermission: (...args) => mockHasPublicPermission(...args),
  grantPermission: (...args) => mockGrantPermission(...args),
  checkPermission: jest.fn().mockResolvedValue(true),
}));

jest.mock('~/server/services/Config', () => ({
  getCachedTools: jest.fn().mockResolvedValue({}),
  getMCPServerTools: jest.fn().mockResolvedValue([]),
}));

jest.mock('~/server/services/MCP', () => ({
  createMCPPermissionContext: jest.fn().mockReturnValue({}),
  resolveConfigServers: jest.fn().mockResolvedValue({}),
  userCanUseMCPServers: jest.fn().mockResolvedValue(false),
}));

jest.mock('~/server/services/Files/images/avatar', () => ({
  resizeAvatar: jest.fn(),
}));

jest.mock('~/server/services/Files/strategies', () => ({
  getStrategyFunctions: jest.fn().mockReturnValue({}),
}));

jest.mock('~/server/utils/getFileStrategy', () => ({
  getFileStrategy: jest.fn().mockReturnValue('local'),
}));

jest.mock('~/server/services/Files/process', () => ({
  filterFile: jest.fn().mockReturnValue(true),
}));

jest.mock('~/cache', () => ({
  getLogStores: jest.fn().mockReturnValue({ get: jest.fn(), set: jest.fn() }),
  logViolation: jest.fn(),
}));

jest.mock('~/config', () => ({
  getMCPServersRegistry: jest.fn().mockReturnValue({}),
}));

jest.mock('~/server/services/Endpoints/agents/skillDeps', () => ({
  canShareSkillsPublicly: (...args) => mockCanShareSkillsPublicly(...args),
  canUseSkills: jest.fn().mockResolvedValue(true),
  canAuthorSkillFiles: jest.fn().mockReturnValue(false),
  withDeploymentSkillIds: jest.fn((ids = []) => ids),
  getSkillToolDeps: jest.fn(() => ({})),
  getSkillDbMethods: jest.fn(() => ({})),
}));

jest.mock('~/models', () => ({
  getAgent: (...args) => mockGetAgent(...args),
  updateAgent: (...args) => mockUpdateAgent(...args),
  revertAgentVersion: (...args) => mockRevertAgentVersion(...args),
  findExistingSkillIdsForTenant: (...args) => mockFindExistingSkillIdsForTenant(...args),
  findEntriesByPrincipalsAndResource: (...args) => mockFindEntriesByPrincipalsAndResource(...args),
  getFiles: jest.fn().mockResolvedValue([]),
  getUserKey: jest.fn(),
  getMessages: jest.fn().mockResolvedValue([]),
  getConvoFiles: jest.fn().mockResolvedValue([]),
  updateFilesUsage: jest.fn(),
  getUserKeyValues: jest.fn().mockResolvedValue([]),
  getToolFilesByIds: jest.fn().mockResolvedValue([]),
  getCodeGeneratedFiles: jest.fn().mockResolvedValue([]),
  getUserCodeFiles: jest.fn().mockResolvedValue([]),
  getCacheMultiplier: jest.fn().mockReturnValue(null),
  getRoleByName: jest.fn().mockResolvedValue(null),
  getAgents: jest.fn().mockResolvedValue([]),
  grantPermission: jest.fn().mockResolvedValue({}),
}));

const mongoose = require('mongoose');
const { Types } = mongoose;
const { MongoMemoryServer } = require('mongodb-memory-server');
const { agentSchema } = require('@librechat/data-schemas');

let mongoServer;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
  if (!mongoose.models.Agent) {
    mongoose.model('Agent', agentSchema);
  }
}, 20000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

beforeEach(async () => {
  await mongoose.models.Agent.deleteMany({});
  jest.clearAllMocks();
  // Default: no public ACL entries (agent is private)
  mockFindEntriesByPrincipalsAndResource.mockResolvedValue([]);
  // Default: SHARE_PUBLIC allowed
  mockCanShareSkillsPublicly.mockResolvedValue(true);
  // Default: no shareable skills
  mockFindAccessibleResources.mockResolvedValue([]);
  mockFindExistingSkillIdsForTenant.mockResolvedValue([]);
  mockGetResourcePermissionsMap.mockResolvedValue(new Map());
});

const makeAgent = (overrides = {}) =>
  Object.assign(
    {
      id: `agent_${new Types.ObjectId().toString()}`,
      name: 'Test Agent',
      author: new Types.ObjectId().toString(),
      provider: 'openai',
      model: 'gpt-4',
      tools: [],
      versions: [{ name: 'Test Agent', createdAt: new Date(), updatedAt: new Date() }],
    },
    overrides,
  );

const makeReq = (overrides = {}) =>
  Object.assign(
    {
      params: { id: 'agent_test' },
      user: { id: new Types.ObjectId().toString(), role: 'USER', tenantId: null },
      body: {},
      config: { endpoints: {} },
      tenant: null,
    },
    overrides,
  );

const makeRes = () => {
  const res = { status: jest.fn(), json: jest.fn() };
  res.status.mockReturnValue(res);
  return res;
};

// ---------------------------------------------------------------------------
// updateAgent — private vs public skill attachment authorization
// ---------------------------------------------------------------------------

describe('updateAgent — skill attachment authorization', () => {
  let updateAgent;

  beforeAll(() => {
    ({ updateAgent } = require('../v1'));
  });

  it('allows attaching a skill to a private agent without SKILLS.SHARE_PUBLIC', async () => {
    const skillId = new Types.ObjectId();
    const agentDoc = await mongoose.models.Agent.create(
      makeAgent({ skills: [], skills_enabled: false }),
    );
    const agentObj = agentDoc.toObject();

    mockGetAgent.mockResolvedValue(agentObj);
    mockUpdateAgent.mockResolvedValue({ ...agentObj, skills: [skillId.toString()] });
    mockFindExistingSkillIdsForTenant.mockResolvedValue([skillId]);
    // User has SHARE access to the skill
    mockFindAccessibleResources.mockResolvedValue([skillId]);
    // Agent is private — no public VIEW entry
    mockFindEntriesByPrincipalsAndResource.mockResolvedValue([]);
    // User does NOT have SKILLS.SHARE_PUBLIC
    mockCanShareSkillsPublicly.mockResolvedValue(false);

    const req = makeReq({
      params: { id: agentDoc.id },
      body: { skills: [skillId.toString()], skills_enabled: true },
    });
    const res = makeRes();

    await updateAgent(req, res);

    // Must not reject with 403 for missing SHARE_PUBLIC on a private agent
    const statusCalls = res.status.mock.calls.map(([code]) => code);
    expect(statusCalls).not.toContain(403);
    expect(statusCalls).not.toContain(400);
  });

  it('blocks attaching a skill to a public agent without SKILLS.SHARE_PUBLIC', async () => {
    const { PermissionBits } = require('librechat-data-provider');
    const skillId = new Types.ObjectId();
    const agentDoc = await mongoose.models.Agent.create(
      makeAgent({ skills: [], skills_enabled: false }),
    );
    const agentObj = agentDoc.toObject();

    mockGetAgent.mockResolvedValue(agentObj);
    mockFindExistingSkillIdsForTenant.mockResolvedValue([skillId]);
    mockFindAccessibleResources.mockResolvedValue([skillId]);
    // Agent IS publicly shared
    mockFindEntriesByPrincipalsAndResource.mockResolvedValue([{ permBits: PermissionBits.VIEW }]);
    // User lacks SKILLS.SHARE_PUBLIC
    mockCanShareSkillsPublicly.mockResolvedValue(false);

    const req = makeReq({
      params: { id: agentDoc.id },
      body: { skills: [skillId.toString()], skills_enabled: true },
    });
    const res = makeRes();

    await updateAgent(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'AGENT_SKILL_PUBLIC_SHARE_FORBIDDEN' }),
    );
  });

  it('rejects attaching more than 100 skills', async () => {
    const skillIds = Array.from({ length: 101 }, () => new Types.ObjectId().toString());
    const agentDoc = await mongoose.models.Agent.create(makeAgent({ skills: [] }));

    mockGetAgent.mockResolvedValue(agentDoc.toObject());

    const req = makeReq({
      params: { id: agentDoc.id },
      body: { skills: skillIds },
    });
    const res = makeRes();

    await updateAgent(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'AGENT_SKILL_LIMIT_EXCEEDED' }),
    );
  });
});

// ---------------------------------------------------------------------------
// revertAgentVersion — 150-skill legacy snapshot capped to 100 atomically
// ---------------------------------------------------------------------------

describe('revertAgentVersion — legacy snapshot cap', () => {
  let revertAgentVersion;

  beforeAll(() => {
    ({ revertAgentVersion } = require('../v1'));
  });

  it('caps a 150-skill snapshot to 100 and writes the capped list via atomicOverrides', async () => {
    const allSkillIds = Array.from({ length: 150 }, () => new Types.ObjectId().toString());
    const snapshotSkillIds = [...allSkillIds];
    const currentSkills = allSkillIds.slice(0, 5);

    const agentDoc = await mongoose.models.Agent.create(
      makeAgent({
        skills: currentSkills,
        skills_enabled: true,
        versions: [
          {
            name: 'v1',
            skills: snapshotSkillIds,
            skills_enabled: true,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ],
      }),
    );
    const agentObj = agentDoc.toObject();

    mockGetAgent.mockResolvedValue(agentObj);

    let capturedOverrides;
    mockRevertAgentVersion.mockImplementation((_filter, _idx, overrides) => {
      capturedOverrides = overrides;
      return Promise.resolve({ ...agentObj, skills: overrides?.skills ?? currentSkills });
    });
    mockUpdateAgent.mockResolvedValue(agentObj);

    // All 100 capped skills are shareable and exist in DB
    const cappedObjectIds = allSkillIds.slice(0, 100).map((id) => new Types.ObjectId(id));
    mockFindAccessibleResources.mockResolvedValue(cappedObjectIds);
    mockFindExistingSkillIdsForTenant.mockResolvedValue(cappedObjectIds);
    // Private agent
    mockFindEntriesByPrincipalsAndResource.mockResolvedValue([]);

    const req = makeReq({
      params: { id: agentDoc.id },
      body: { version_index: 0 },
    });
    const res = makeRes();

    await revertAgentVersion(req, res);

    // The override must be set so the capped list lands atomically
    expect(capturedOverrides).toBeDefined();
    expect(capturedOverrides.skills).toHaveLength(100);
    expect(capturedOverrides.skills.map(String)).toEqual(allSkillIds.slice(0, 100).map(String));
  });
});
