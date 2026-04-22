import type { Model } from 'mongoose';
import type { INotification } from '~/types/notification';
import { applyTenantIsolation } from '~/models/plugins/tenantIsolation';
import notificationSchema from '~/schema/notification';

export function createNotificationModel(mongoose: typeof import('mongoose')): Model<INotification> {
  applyTenantIsolation(notificationSchema);
  return (
    mongoose.models.Notification ||
    mongoose.model<INotification>('Notification', notificationSchema)
  );
}
