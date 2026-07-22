const express = require('express');
const request = require('supertest');

const mockNotifyAgentVerificationActivity = jest.fn().mockResolvedValue({ createdCount: 1 });
const mockGetAgent = jest.fn();
const mockGetLatestReview = jest.fn();
const mockAddOrUpdateReview = jest.fn();

jest.mock('@librechat/api', () => ({
  ...jest.requireActual('@librechat/api'),
  notifyAgentVerificationActivity: (...args) => mockNotifyAgentVerificationActivity(...args),
  generateCheckAccess: () => (_req, _res, next) => next(),
  checkAccess: jest.fn().mockResolvedValue(true),
}));

jest.mock('@librechat/data-schemas', () => ({
  logger: {
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
  },
}));

jest.mock('~/models', () => ({
  getAgent: (...args) => mockGetAgent(...args),
  findEntriesByResource: jest.fn(),
  findUsers: jest.fn(),
  getRoleByName: jest.fn(),
  createNotificationsForUsers: jest.fn(),
}));

jest.mock('~/models/AgentReview', () => ({
  getLatestReview: (...args) => mockGetLatestReview(...args),
  addOrUpdateReview: (...args) => mockAddOrUpdateReview(...args),
  getAgentReview: jest.fn(),
  getAllReviews: jest.fn(),
  deleteReview: jest.fn(),
}));

jest.mock('~/server/middleware', () => ({
  requireJwtAuth: (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    next();
  },
  configMiddleware: (req, _res, next) => {
    req.config = { interfaceConfig: { marketplace: { verification: true } } };
    next();
  },
  canAccessAgentResource: () => (_req, _res, next) => next(),
}));

jest.mock('~/server/controllers/agents/v1', () => ({
  getAgentCategories: (_req, res) => res.json([]),
  createAgent: (_req, res) => res.status(201).json({}),
  getAgent: (_req, res) => res.json({}),
  updateAgent: (_req, res) => res.json({}),
  duplicateAgent: (_req, res) => res.status(201).json({}),
  deleteAgent: (_req, res) => res.json({}),
  revertAgentVersion: (_req, res) => res.json({}),
  getListAgents: (_req, res) => res.json({ data: [] }),
  uploadAgentAvatar: (_req, res) => res.json({}),
}));

jest.mock('~/server/routes/agents/actions', () => require('express').Router());
jest.mock('~/server/routes/agents/tools', () => require('express').Router());

const { v1: agentsRouter } = require('../v1');

function createApp(user) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = user;
    next();
  });
  app.use('/api/agents', agentsRouter);
  return app;
}

describe('POST /api/agents/:id/review notifications', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetAgent.mockResolvedValue({
      id: 'agent_test',
      name: 'Test Agent',
      _id: '507f1f77bcf86cd799439011',
      author: 'owner-user-id',
    });
    mockGetLatestReview.mockResolvedValue({ verified: false });
    mockAddOrUpdateReview.mockResolvedValue({
      reviews: [
        {
          _id: 'review-1',
          verified: true,
          comment: 'Looks good',
          reviewed_by: 'admin-user',
          reviewed_by_name: 'Admin User',
          reviewed_at: new Date().toISOString(),
        },
      ],
    });
  });

  it('dispatches verification notifications after a successful review submission', async () => {
    const app = createApp({
      id: 'admin-user',
      name: 'Admin User',
      role: 'ADMIN',
    });

    const response = await request(app)
      .post('/api/agents/agent_test/review')
      .send({ verified: true, comment: 'Looks good' })
      .expect(200);

    expect(response.body.comment).toBe('Looks good');
    expect(mockAddOrUpdateReview).toHaveBeenCalledWith('agent_test', {
      verified: true,
      comment: 'Looks good',
      reviewed_by: 'admin-user',
      reviewed_by_name: 'Admin User',
    });

    expect(mockNotifyAgentVerificationActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        agent: expect.objectContaining({ id: 'agent_test' }),
        actor: { id: 'admin-user', name: 'Admin User' },
        previousVerified: false,
        newVerified: true,
        comment: 'Looks good',
      }),
    );
  });
});
