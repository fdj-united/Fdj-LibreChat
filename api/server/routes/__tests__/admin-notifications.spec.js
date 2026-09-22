const express = require('express');
const request = require('supertest');

jest.mock('@librechat/api', () => jest.requireActual('../../../../packages/api/dist'));

const mockCreateBroadcastNotification = jest.fn();
const mockDeleteBroadcastNotification = jest.fn();

jest.mock('@librechat/data-schemas', () => ({
  SystemCapabilities: {
    ACCESS_ADMIN: 'access:admin',
  },
}));

jest.mock('~/models', () => ({
  createBroadcastNotification: (...args) => mockCreateBroadcastNotification(...args),
  deleteBroadcastNotification: (...args) => mockDeleteBroadcastNotification(...args),
}));

jest.mock('~/server/middleware', () => ({
  requireJwtAuth: (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    next();
  },
}));

jest.mock('~/server/middleware/roles/capabilities', () => ({
  requireCapability: () => (req, res, next) => {
    if (!req.user || req.user.role !== 'ADMIN') {
      return res.status(403).json({ error: 'Forbidden' });
    }
    next();
  },
}));

const adminNotificationsRoute = require('../admin/notifications');

function createApp(user, { withGlobalParser = false } = {}) {
  const app = express();
  if (withGlobalParser) {
    app.use(express.json({ limit: '3mb' }));
  } else {
    app.use(express.json());
  }
  app.use((req, _res, next) => {
    req.user = user;
    next();
  });
  app.use('/api/admin/notifications', adminNotificationsRoute);
  return app;
}

describe('Admin notifications route', () => {
  beforeEach(() => {
    mockCreateBroadcastNotification.mockReset();
    mockDeleteBroadcastNotification.mockReset();
  });

  it('forbids non-admin callers', async () => {
    const app = createApp({ id: 'u1', role: 'USER' });
    const response = await request(app)
      .post('/api/admin/notifications/broadcast')
      .send({
        type: 'announcement',
        title: 'New KAIT capability',
        message: 'Feature announcement',
      })
      .expect(403);

    expect(response.body.error).toBe('Forbidden');
    expect(mockCreateBroadcastNotification).not.toHaveBeenCalled();
  });

  it('creates announcement broadcasts for admin and returns createdCount', async () => {
    mockCreateBroadcastNotification.mockResolvedValue({ createdCount: 42 });
    const app = createApp({ id: 'admin-1', role: 'ADMIN' });

    const response = await request(app)
      .post('/api/admin/notifications/broadcast')
      .send({
        type: 'announcement',
        title: 'New KAIT capability',
        message: 'Feature announcement',
        link: '/c/new',
      })
      .expect(201);

    expect(mockCreateBroadcastNotification).toHaveBeenCalledWith({
      type: 'announcement',
      title: 'New KAIT capability',
      message: 'Feature announcement',
      link: '/c/new',
    });
    expect(response.body).toEqual({ created: true, createdCount: 42 });
  });

  it('rejects payloads larger than 100KB even with a global 3MB parser', async () => {
    const app = createApp({ id: 'admin-1', role: 'ADMIN' }, { withGlobalParser: true });

    const response = await request(app)
      .post('/api/admin/notifications/broadcast')
      .send({
        type: 'announcement',
        title: 'x'.repeat(102400),
        message: 'y',
      })
      .expect(413);

    expect(response.body.error).toBe('Request body too large');
    expect(mockCreateBroadcastNotification).not.toHaveBeenCalled();
  });

  it('rejects broadcast types other than announcement', async () => {
    const app = createApp({ id: 'admin-1', role: 'ADMIN' });

    const response = await request(app)
      .post('/api/admin/notifications/broadcast')
      .send({
        type: 'system',
        title: 'System message',
        message: 'Only announcements allowed',
      })
      .expect(400);

    expect(response.body.error).toContain('type "announcement"');
    expect(mockCreateBroadcastNotification).not.toHaveBeenCalled();
  });

  it('deletes announcement broadcasts for admin and returns deletedCount', async () => {
    mockDeleteBroadcastNotification.mockResolvedValue({ deleted: true, deletedCount: 42 });
    const app = createApp({ id: 'admin-1', role: 'ADMIN' });

    const response = await request(app)
      .delete('/api/admin/notifications/broadcast/507f1f77bcf86cd799439011')
      .expect(200);

    expect(mockDeleteBroadcastNotification).toHaveBeenCalledWith('507f1f77bcf86cd799439011');
    expect(response.body).toEqual({ deleted: true, deletedCount: 42 });
  });

  it('returns 404 when announcement broadcast is not found', async () => {
    mockDeleteBroadcastNotification.mockResolvedValue({ deleted: false, deletedCount: 0 });
    const app = createApp({ id: 'admin-1', role: 'ADMIN' });

    const response = await request(app)
      .delete('/api/admin/notifications/broadcast/507f1f77bcf86cd799439011')
      .expect(404);

    expect(response.body.error).toBe('Announcement not found.');
  });

  it('forbids non-admin callers from deleting broadcasts', async () => {
    const app = createApp({ id: 'u1', role: 'USER' });

    const response = await request(app)
      .delete('/api/admin/notifications/broadcast/507f1f77bcf86cd799439011')
      .expect(403);

    expect(response.body.error).toBe('Forbidden');
    expect(mockDeleteBroadcastNotification).not.toHaveBeenCalled();
  });
});
