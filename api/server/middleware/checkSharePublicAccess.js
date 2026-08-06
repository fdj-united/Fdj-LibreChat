const { createSharePolicyMiddleware } = require('@librechat/api');
const { hasCapability } = require('~/server/middleware/roles/capabilities');
const { getRoleByName, getAgent } = require('~/models');

module.exports = createSharePolicyMiddleware({
  getRoleByName,
  hasCapability,
  getAgentById: ({ id }) => getAgent({ id }),
});
