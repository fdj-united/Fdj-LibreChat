import {
  PermissionBits,
  PermissionTypes,
  Permissions,
  PrincipalType,
  ResourceType,
  SystemRoles,
  type NotificationType,
} from 'librechat-data-provider';

const COMMENT_PREVIEW_MAX = 120;
const AGENT_VERIFICATION_TYPE = 'agent_verification' as NotificationType;
export const AGENT_VERIFICATION_REVIEW_PANEL_ID = 'review-agent';

export function buildAgentVerificationReviewLink(agentId: string): string {
  const params = new URLSearchParams({
    agent_id: agentId,
    panel: AGENT_VERIFICATION_REVIEW_PANEL_ID,
  });
  return `/c/new?${params.toString()}`;
}

export type AgentVerificationAgent = {
  id: string;
  name?: string | null;
  _id: string | { toString(): string };
  author?: string | { toString(): string } | null;
};

export type AgentVerificationActor = {
  id: string;
  name: string;
};

type AclEntryLike = {
  principalType: string;
  principalId?: string | { toString(): string };
  permBits: number;
};

export type VerificationNotificationDeps = {
  findEntriesByResource: (
    resourceType: string,
    resourceId: string | { toString(): string },
  ) => Promise<AclEntryLike[]>;
  findUsers: (
    searchCriteria: { role?: string },
    fieldsToSelect?: string | null,
    options?: { limit?: number },
  ) => Promise<Array<{ _id: { toString(): string } }>>;
  getRoleByName: (
    name: string,
  ) => Promise<{ permissions?: Record<string, Record<string, boolean>> } | null>;
  createNotificationsForUsers: (params: {
    userIds: string[];
    type: NotificationType;
    title: string;
    message: string;
    link?: string;
  }) => Promise<{ createdCount: number }>;
};

export type NotifyAgentVerificationActivityParams = {
  agent: AgentVerificationAgent;
  actor: AgentVerificationActor;
  previousVerified: boolean | null;
  newVerified: boolean;
  comment: string;
  deps: VerificationNotificationDeps;
};

function truncatePreview(text: string, max = COMMENT_PREVIEW_MAX): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) {
    return trimmed;
  }
  return `${trimmed.slice(0, max - 1)}…`;
}

function uniqueIds(ids: string[]): string[] {
  return [...new Set(ids)];
}

function resolveOwnerUserIds(entries: AclEntryLike[], authorId: string | null): string[] {
  const ownerIds = entries
    .filter(
      (entry) =>
        entry.principalType === PrincipalType.USER &&
        entry.principalId != null &&
        (entry.permBits & PermissionBits.DELETE) > 0,
    )
    .map((entry) => entry.principalId!.toString());

  if (ownerIds.length > 0) {
    return uniqueIds(ownerIds);
  }

  return authorId ? [authorId] : [];
}

async function resolveAdminUserIds(deps: VerificationNotificationDeps): Promise<string[]> {
  const adminRole = await deps.getRoleByName(SystemRoles.ADMIN);
  const marketplacePerms = adminRole?.permissions?.[PermissionTypes.MARKETPLACE];
  if (!marketplacePerms?.[Permissions.USE]) {
    return [];
  }

  const admins = await deps.findUsers({ role: SystemRoles.ADMIN }, '_id', { limit: 1000 });
  return admins.map((user) => user._id.toString());
}

function buildStatusContent(
  agentName: string,
  actorName: string,
  comment: string,
  newVerified: boolean,
) {
  const statusLabel = newVerified ? 'verified' : 'unverified';
  const title = `${agentName} verification ${statusLabel}`;
  const trimmedComment = comment.trim();
  const message =
    trimmedComment.length > 0
      ? `${actorName} changed verification status: ${truncatePreview(trimmedComment)}`
      : `${actorName} changed verification status`;
  return { title, message };
}

function buildCommentContent(agentName: string, actorName: string, comment: string) {
  return {
    title: `New comment on ${agentName}`,
    message: `${actorName}: ${truncatePreview(comment)}`,
  };
}

export async function notifyAgentVerificationActivity({
  agent,
  actor,
  previousVerified,
  newVerified,
  comment,
  deps,
}: NotifyAgentVerificationActivityParams): Promise<{ createdCount: number }> {
  const hasComment = comment.trim().length > 0;
  const statusChanged = previousVerified !== null && previousVerified !== newVerified;

  if (!hasComment && !statusChanged) {
    return { createdCount: 0 };
  }

  const agentName = agent.name?.trim() || agent.id;
  const link = buildAgentVerificationReviewLink(agent.id);

  const entries = await deps.findEntriesByResource(ResourceType.AGENT, agent._id);
  const authorId = agent.author != null ? agent.author.toString() : null;
  const ownerIds = resolveOwnerUserIds(entries, authorId);

  const statusRecipients: string[] = [];
  const commentRecipients: string[] = [];

  if (statusChanged) {
    statusRecipients.push(...ownerIds.filter((id) => id !== actor.id));
  }

  if (hasComment) {
    if (!statusChanged) {
      commentRecipients.push(...ownerIds.filter((id) => id !== actor.id));
    }

    const adminIds = await resolveAdminUserIds(deps);
    for (const id of adminIds) {
      if (id === actor.id) {
        continue;
      }
      if (statusChanged && ownerIds.includes(id)) {
        continue;
      }
      commentRecipients.push(id);
    }
  }

  let createdCount = 0;

  if (statusRecipients.length > 0) {
    const { title, message } = buildStatusContent(agentName, actor.name, comment, newVerified);
    const result = await deps.createNotificationsForUsers({
      userIds: uniqueIds(statusRecipients),
      type: AGENT_VERIFICATION_TYPE,
      title,
      message,
      link,
    });
    createdCount += result.createdCount;
  }

  if (commentRecipients.length > 0) {
    const { title, message } = buildCommentContent(agentName, actor.name, comment);
    const result = await deps.createNotificationsForUsers({
      userIds: uniqueIds(commentRecipients),
      type: AGENT_VERIFICATION_TYPE,
      title,
      message,
      link,
    });
    createdCount += result.createdCount;
  }

  return { createdCount };
}
