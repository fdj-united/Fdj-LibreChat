const { createBalanceHandlers } = require('@librechat/api');
const { getAppConfig } = require('~/server/services/Config');
const {
  findBalanceByUser,
  findPendingBalanceRequestByUser,
  createBalanceRequest,
  maybeApplyAutoRefill,
} = require('~/models');

const handlers = createBalanceHandlers({
  findBalanceByUser,
  findPendingBalanceRequestByUser,
  createBalanceRequest,
  getAppConfig,
  maybeApplyAutoRefill,
});

module.exports = handlers;
