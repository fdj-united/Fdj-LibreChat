const { logger } = require('@librechat/data-schemas');
const {
  getAppConfigOptionsFromUser,
  createStreamKeepaliveLoader,
} = require('@librechat/api');
const { getAppConfig } = require('~/server/services/Config');

const configMiddleware = async (req, res, next) => {
  try {
    req.config = await getAppConfig(getAppConfigOptionsFromUser(req.user));

    next();
  } catch (error) {
    logger.error('Config middleware error:', {
      error: getSafeErrorMetadata(error),
      userRole: req.user?.role,
      path: req.path,
    });

    try {
      req.config = await getAppConfig({ tenantId: req.user?.tenantId });
      next();
    } catch (fallbackError) {
      logger.error('Fallback config middleware error:', getSafeErrorMetadata(fallbackError));
      next(fallbackError);
    }
  }
};

module.exports = configMiddleware;
module.exports.loadStreamKeepaliveMs = createStreamKeepaliveLoader(getAppConfig);
