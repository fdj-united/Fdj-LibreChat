export const notificationTypes = ['generic', 'system', 'announcement', 'agent_verification'] as const;

export type NotificationType = (typeof notificationTypes)[number];
