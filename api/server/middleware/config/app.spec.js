const { logger } = require('@librechat/data-schemas');
const { getAppConfig } = require('~/server/services/Config');
const configMiddleware = require('./app');

jest.mock('@librechat/data-schemas', () => ({ logger: { error: jest.fn() } }));
jest.mock('@librechat/api', () => ({
  ...jest.requireActual('@librechat/api'),
  getAppConfigOptionsFromUser: (user) => ({ tenantId: user.tenantId, role: user.role }),
}));
jest.mock('~/server/services/Config', () => ({ getAppConfig: jest.fn() }));

describe('app config middleware', () => {
  const user = { tenantId: 'tenant-test', role: 'USER' };

  beforeEach(() => {
    jest.clearAllMocks();
    getAppConfig.mockReset();
  });

  it('loads user configuration before continuing the request', async () => {
    const config = { insights: { privacy: { includeFirstMessage: false } } };
    getAppConfig.mockResolvedValueOnce(config);
    const req = { user, path: '/api/insights' };
    const next = jest.fn();

    await configMiddleware(req, {}, next);

    expect(req.config).toBe(config);
    expect(getAppConfig).toHaveBeenCalledWith({ tenantId: 'tenant-test', role: 'USER' });
    expect(next).toHaveBeenCalledWith();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('recovers with tenant configuration and logs only safe error metadata', async () => {
    const config = { insights: { charts: { dailyUsage: true } } };
    getAppConfig.mockRejectedValueOnce(new Error('private config contents'));
    getAppConfig.mockResolvedValueOnce(config);
    const req = { user, path: '/api/insights' };
    const next = jest.fn();

    await configMiddleware(req, {}, next);

    expect(getAppConfig).toHaveBeenLastCalledWith({ tenantId: 'tenant-test' });
    expect(req.config).toBe(config);
    expect(next).toHaveBeenCalledWith();
    expect(logger.error).toHaveBeenCalledWith('Config middleware error:', {
      error: { type: 'Error' },
      userRole: 'USER',
      path: '/api/insights',
    });
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain('private config contents');
  });

  it('forwards a failed fallback without exposing either error in logs', async () => {
    const fallbackError = new Error('private fallback contents');
    getAppConfig.mockRejectedValueOnce(new Error('private initial contents'));
    getAppConfig.mockRejectedValueOnce(fallbackError);
    const next = jest.fn();

    await configMiddleware({ user, path: '/api/insights' }, {}, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledWith(fallbackError);
    expect(logger.error).toHaveBeenLastCalledWith('Fallback config middleware error:', {
      type: 'Error',
    });
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain('private');
  });
});
