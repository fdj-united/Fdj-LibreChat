import { logger, SystemCapabilities } from '@librechat/data-schemas';
import { PermissionBits, ResourceType } from 'librechat-data-provider';
import type { IUser, SystemCapability } from '@librechat/data-schemas';
import { hasManageAgentsCapability } from './reads';

/** ACL implementations may return either plain IDs or objects with a string representation. */
type ResourceId = string | { toString(): string };

type AgentListAccessDeps = {
  hasCapability: (user: IUser, capability: SystemCapability) => Promise<boolean>;
  findAccessibleResources: (params: {
    userId: string;
    role?: string;
    idOnTheSource?: string;
    resourceType: ResourceType;
    requiredPermissions: PermissionBits;
  }) => Promise<ResourceId[]>;
};

type AgentListAccessOptions = {
  /** Allow read:agents to use the tenant-scoped all-agent listing path. */
  allowReadAllAgents?: boolean;
};

async function hasReadAllAgentsCapability(
  user: IUser,
  deps: Pick<AgentListAccessDeps, 'hasCapability'>,
): Promise<boolean> {
  try {
    return await deps.hasCapability(user, SystemCapabilities.READ_AGENTS);
  } catch (error) {
    logger.warn(
      `[AgentListing] Agent read capability check failed, denying bypass: ${(error as Error).message}`,
    );
    return false;
  }
}

export async function getAgentListAccess(
  user: IUser,
  requiredPermissions: PermissionBits,
  deps: AgentListAccessDeps,
  options: AgentListAccessOptions = {},
): Promise<{ accessibleIds: string[] | null; editableIds: string[] | null }> {
  if (typeof requiredPermissions !== 'number' || requiredPermissions < 1) {
    throw new Error('requiredPermissions must be a positive number');
  }

  const params = {
    userId: user.id,
    role: user.role,
    idOnTheSource: user.idOnTheSource,
    resourceType: ResourceType.AGENT,
  };
  // The normal startup path must not wait for a capability DB read before issuing ACL reads.
  const aclReads = Promise.all([
    deps.findAccessibleResources({ ...params, requiredPermissions }),
    (requiredPermissions & PermissionBits.EDIT) === PermissionBits.EDIT
      ? null
      : deps.findAccessibleResources({ ...params, requiredPermissions: PermissionBits.EDIT }),
  ]);
  // A manager can proceed even if a speculative ACL read rejects before the capability resolves.
  void aclReads.catch(() => undefined);
  const [canManageAll, canReadAll] = await Promise.all([
    hasManageAgentsCapability(user, deps),
    options.allowReadAllAgents === true && requiredPermissions === PermissionBits.VIEW
      ? hasReadAllAgentsCapability(user, deps)
      : Promise.resolve(false),
  ]);
  if (canManageAll) {
    return { accessibleIds: null, editableIds: null };
  }

  let accessibleIds: ResourceId[];
  let editableIds: ResourceId[] | null;
  try {
    [accessibleIds, editableIds] = await aclReads;
  } catch (error) {
    if (!canReadAll) {
      throw error;
    }
    logger.warn(
      `[AgentListing] Agent ACL lookup failed for read-only listing; returning no edit grants: ${(error as Error).message}`,
    );
    return { accessibleIds: null, editableIds: [] };
  }
  if (canReadAll) {
    return { accessibleIds: null, editableIds: editableIds?.map(String) ?? [] };
  }
  return {
    accessibleIds: accessibleIds.map(String),
    editableIds: editableIds?.map(String) ?? null,
  };
}
