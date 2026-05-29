const express = require('express');
const request = require('supertest');
const { SystemRoles } = require('librechat-data-provider');

jest.mock('@librechat/api', () => ({
  generateCheckAccess: jest.fn(() => (_req, _res, next) => next()),
  checkAccess: jest.fn(async (params) =>
    params?.req?.headers?.['x-test-marketplace-access'] === 'true',
  ),
}));

jest.mock('~/server/controllers/agents/v1', () => ({
  createAgent: jest.fn(),
  getAgent: jest.fn(),
  updateAgent: jest.fn(),
  duplicateAgent: jest.fn(),
  deleteAgent: jest.fn(),
  revertAgentVersion: jest.fn(),
  getListAgents: jest.fn(),
  uploadAgentAvatar: jest.fn(),
  getAgentCategories: jest.fn(),
}));

jest.mock('~/models/Agent', () => ({
  getAgent: jest.fn(),
}));

jest.mock('~/models/AgentReview', () => ({
  addOrUpdateReview: jest.fn(),
  getAgentReview: jest.fn(),
  getLatestReview: jest.fn(),
  getAllReviews: jest.fn(),
  deleteReview: jest.fn(),
}));

jest.mock('~/models/Role', () => ({
  getRoleByName: jest.fn(),
}));

jest.mock('./actions', () => {
  const mockExpress = require('express');
  return mockExpress.Router();
});
jest.mock('./tools', () => {
  const mockExpress = require('express');
  return mockExpress.Router();
});

jest.mock('~/server/middleware', () => ({
  requireJwtAuth: jest.fn((req, _res, next) => {
    const role = req.headers['x-test-role'] || 'USER';
    const id = req.headers['x-test-user-id'];
    req.user = {
      id: id || 'user-id',
      role,
      name: role === 'ADMIN' ? 'Admin User' : 'Standard User',
      username: role === 'ADMIN' ? 'admin' : 'user',
      email: role === 'ADMIN' ? 'admin@example.com' : 'user@example.com',
    };
    next();
  }),
  configMiddleware: jest.fn((_req, _res, next) => next()),
  canAccessAgentResource: jest.fn(() => (_req, _res, next) => next()),
}));

describe('Agent review permissions', () => {
  let app;
  let latestReviewState;
  let agentId;
  let adminId;
  let userId;
  const { getAgent } = require('~/models');
  const { addOrUpdateReview, getLatestReview } = require('~/models/AgentReview');

  beforeEach(() => {
    jest.clearAllMocks();
    adminId = 'admin-id';
    userId = 'user-id';
    agentId = 'agent_test_123';
    latestReviewState = null;

    getAgent.mockImplementation(async ({ id }) => {
      if (id !== agentId) {
        return null;
      }
      return { id: agentId, name: 'Review Permission Agent' };
    });

    getLatestReview.mockImplementation(async () => latestReviewState);

    addOrUpdateReview.mockImplementation(async (_id, reviewData) => {
      latestReviewState = {
        _id: 'review-subdoc-id',
        verified: reviewData.verified,
        comment: reviewData.comment,
        reviewed_by: reviewData.reviewed_by,
        reviewed_by_name: reviewData.reviewed_by_name,
        reviewed_at: new Date().toISOString(),
      };
      return { reviews: [latestReviewState] };
    });

    const { v1: agentRoutes } = require('./v1');
    app = express();
    app.use(express.json());
    app.use('/agents', agentRoutes);
  });

  it('keeps verification unchanged for admin without marketplace access', async () => {
    await request(app)
      .post(`/agents/${agentId}/review`)
      .set('x-test-role', SystemRoles.ADMIN)
      .set('x-test-user-id', adminId)
      .set('x-test-marketplace-access', 'true')
      .send({ verified: true, comment: 'Initial verification by admin' });

    const response = await request(app)
      .post(`/agents/${agentId}/review`)
      .set('x-test-role', SystemRoles.ADMIN)
      .set('x-test-user-id', adminId)
      .set('x-test-marketplace-access', 'false')
      .send({ verified: false, comment: 'Admin without marketplace access' });

    expect(response.status).toBe(200);
    expect(response.body.comment).toBe('Admin without marketplace access');
    expect(response.body.verified).toBe(true);
  });

  it('allows admin with marketplace access to update verification status', async () => {
    const response = await request(app)
      .post(`/agents/${agentId}/review`)
      .set('x-test-role', SystemRoles.ADMIN)
      .set('x-test-user-id', adminId)
      .set('x-test-marketplace-access', 'true')
      .send({ verified: true, comment: 'Admin verified this agent' });

    expect(response.status).toBe(200);
    expect(response.body.verified).toBe(true);
    expect(response.body.comment).toBe('Admin verified this agent');
  });

  it('keeps verification unchanged for non-admin while allowing comments', async () => {
    await request(app)
      .post(`/agents/${agentId}/review`)
      .set('x-test-role', SystemRoles.ADMIN)
      .set('x-test-user-id', adminId)
      .set('x-test-marketplace-access', 'true')
      .send({ verified: true, comment: 'Initial verification by admin' });

    const response = await request(app)
      .post(`/agents/${agentId}/review`)
      .set('x-test-role', SystemRoles.USER)
      .set('x-test-user-id', userId)
      .set('x-test-marketplace-access', 'false')
      .send({ verified: false, comment: 'Non-admin feedback only' });

    expect(response.status).toBe(200);
    expect(response.body.comment).toBe('Non-admin feedback only');
    expect(response.body.verified).toBe(true);

    const latest = await getLatestReview();
    expect(latest?.verified).toBe(true);
    expect(latest?.comment).toBe('Non-admin feedback only');
  });
});
