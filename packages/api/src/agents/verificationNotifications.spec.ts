import {
  PermissionBits,
  PermissionTypes,
  Permissions,
  PrincipalType,
  ResourceType,
  SystemRoles,
} from 'librechat-data-provider';
import {
  notifyAgentVerificationActivity,
  buildAgentVerificationReviewLink,
} from './verificationNotifications';

function createDeps(overrides: Partial<Parameters<typeof notifyAgentVerificationActivity>[0]['deps']> = {}) {
  const createNotificationsForUsers = jest.fn().mockResolvedValue({ createdCount: 1 });

  return {
    findEntriesByResource: jest.fn().mockResolvedValue([]),
    findUsers: jest.fn().mockResolvedValue([]),
    getRoleByName: jest.fn().mockResolvedValue({
      permissions: {
        [PermissionTypes.MARKETPLACE]: {
          [Permissions.USE]: true,
        },
      },
    }),
    createNotificationsForUsers,
    ...overrides,
  };
}

const baseAgent = {
  id: 'agent_abc',
  name: 'Test Agent',
  _id: '507f1f77bcf86cd799439011',
  author: 'owner-user-id',
};

const baseActor = {
  id: 'reviewer-id',
  name: 'Reviewer',
};

describe('notifyAgentVerificationActivity', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('builds review deep links with agent id and review panel', () => {
    expect(buildAgentVerificationReviewLink('agent_abc')).toBe(
      '/c/new?agent_id=agent_abc&panel=review-agent',
    );
  });

  it('does nothing when there is no comment and no status change', async () => {
    const deps = createDeps();

    const result = await notifyAgentVerificationActivity({
      agent: baseAgent,
      actor: baseActor,
      previousVerified: false,
      newVerified: false,
      comment: '   ',
      deps,
    });

    expect(result.createdCount).toBe(0);
    expect(deps.createNotificationsForUsers).not.toHaveBeenCalled();
  });

  it('notifies owners on status change only', async () => {
    const deps = createDeps({
      findEntriesByResource: jest.fn().mockResolvedValue([
        {
          principalType: PrincipalType.USER,
          principalId: 'owner-1',
          permBits: PermissionBits.DELETE,
        },
      ]),
    });

    await notifyAgentVerificationActivity({
      agent: baseAgent,
      actor: baseActor,
      previousVerified: false,
      newVerified: true,
      comment: '',
      deps,
    });

    expect(deps.createNotificationsForUsers).toHaveBeenCalledTimes(1);
    expect(deps.createNotificationsForUsers).toHaveBeenCalledWith(
      expect.objectContaining({
        userIds: ['owner-1'],
        type: 'agent_verification',
        title: 'Test Agent verification verified',
        link: '/c/new?agent_id=agent_abc&panel=review-agent',
      }),
    );
    expect(deps.findUsers).not.toHaveBeenCalled();
  });

  it('notifies owners and admins on comment only', async () => {
    const deps = createDeps({
      findEntriesByResource: jest.fn().mockResolvedValue([
        {
          principalType: PrincipalType.USER,
          principalId: 'owner-1',
          permBits: PermissionBits.DELETE,
        },
      ]),
      findUsers: jest.fn().mockResolvedValue([{ _id: { toString: () => 'admin-1' } }]),
    });

    await notifyAgentVerificationActivity({
      agent: baseAgent,
      actor: baseActor,
      previousVerified: false,
      newVerified: false,
      comment: 'Needs changes',
      deps,
    });

    expect(deps.createNotificationsForUsers).toHaveBeenCalledTimes(1);
    expect(deps.createNotificationsForUsers).toHaveBeenCalledWith(
      expect.objectContaining({
        userIds: expect.arrayContaining(['owner-1', 'admin-1']),
        title: 'New comment on Test Agent',
        message: 'Reviewer: Needs changes',
      }),
    );
  });

  it('excludes the actor from recipients', async () => {
    const deps = createDeps({
      findEntriesByResource: jest.fn().mockResolvedValue([
        {
          principalType: PrincipalType.USER,
          principalId: 'reviewer-id',
          permBits: PermissionBits.DELETE,
        },
      ]),
    });

    await notifyAgentVerificationActivity({
      agent: baseAgent,
      actor: baseActor,
      previousVerified: false,
      newVerified: true,
      comment: 'Self review',
      deps,
    });

    expect(deps.createNotificationsForUsers).not.toHaveBeenCalled();
  });

  it('falls back to agent author when no ACL owners exist', async () => {
    const deps = createDeps();

    await notifyAgentVerificationActivity({
      agent: baseAgent,
      actor: baseActor,
      previousVerified: false,
      newVerified: true,
      comment: '',
      deps,
    });

    expect(deps.createNotificationsForUsers).toHaveBeenCalledWith(
      expect.objectContaining({
        userIds: ['owner-user-id'],
      }),
    );
  });

  it('sends status notification to owners and comment notification to non-owner admins when both change', async () => {
    const deps = createDeps({
      findEntriesByResource: jest.fn().mockResolvedValue([
        {
          principalType: PrincipalType.USER,
          principalId: 'owner-1',
          permBits: PermissionBits.DELETE,
        },
        {
          principalType: PrincipalType.USER,
          principalId: 'owner-admin',
          permBits: PermissionBits.DELETE,
        },
      ]),
      findUsers: jest.fn().mockResolvedValue([
        { _id: { toString: () => 'owner-admin' } },
        { _id: { toString: () => 'admin-only' } },
      ]),
    });

    await notifyAgentVerificationActivity({
      agent: baseAgent,
      actor: baseActor,
      previousVerified: false,
      newVerified: true,
      comment: 'Approved with notes',
      deps,
    });

    expect(deps.createNotificationsForUsers).toHaveBeenCalledTimes(2);

    expect(deps.createNotificationsForUsers).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        userIds: expect.arrayContaining(['owner-1', 'owner-admin']),
        title: 'Test Agent verification verified',
      }),
    );

    expect(deps.createNotificationsForUsers).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        userIds: ['admin-only'],
        title: 'New comment on Test Agent',
      }),
    );
  });

  it('skips admin notifications when ADMIN role lacks marketplace access', async () => {
    const deps = createDeps({
      getRoleByName: jest.fn().mockResolvedValue({
        permissions: {
          [PermissionTypes.MARKETPLACE]: {
            [Permissions.USE]: false,
          },
        },
      }),
      findUsers: jest.fn().mockResolvedValue([{ _id: { toString: () => 'admin-1' } }]),
    });

    await notifyAgentVerificationActivity({
      agent: baseAgent,
      actor: baseActor,
      previousVerified: false,
      newVerified: false,
      comment: 'Comment only',
      deps,
    });

    expect(deps.findUsers).not.toHaveBeenCalled();
    expect(deps.createNotificationsForUsers).toHaveBeenCalledWith(
      expect.objectContaining({
        userIds: ['owner-user-id'],
      }),
    );
  });

  it('queries ACL entries for the agent resource', async () => {
    const findEntriesByResource = jest.fn().mockResolvedValue([]);
    const deps = createDeps({ findEntriesByResource });

    await notifyAgentVerificationActivity({
      agent: baseAgent,
      actor: baseActor,
      previousVerified: false,
      newVerified: true,
      comment: '',
      deps,
    });

    expect(findEntriesByResource).toHaveBeenCalledWith(
      ResourceType.AGENT,
      baseAgent._id,
    );
    expect(deps.getRoleByName).not.toHaveBeenCalledWith(SystemRoles.ADMIN);
  });
});
