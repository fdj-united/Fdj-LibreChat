import { SystemRoles, Permissions, PermissionBits, PermissionTypes } from 'librechat-data-provider';
import { useAuthContext } from '~/hooks/AuthContext';
import { useHasAccess } from '~/hooks/Roles';

/**
 * Hook to determine the appropriate permission level for agent queries based on marketplace configuration.
 * Admins use VIEW so Configure lists the same agents as Review (EDIT ACL is narrower than VIEW).
 * API edit/update still works via manage:agents capability bypass.
 */
const useAgentDefaultPermissionLevel = () => {
  const { user } = useAuthContext();
  const hasMarketplaceAccess = useHasAccess({
    permissionType: PermissionTypes.MARKETPLACE,
    permission: Permissions.USE,
  });

  if (user?.role === SystemRoles.ADMIN) {
    return PermissionBits.VIEW;
  }

  // When marketplace is active: EDIT permissions (builder mode)
  // When marketplace is not active: VIEW permissions (browse mode)
  return hasMarketplaceAccess ? PermissionBits.EDIT : PermissionBits.VIEW;
};

export default useAgentDefaultPermissionLevel;
