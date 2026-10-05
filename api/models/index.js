const mongoose = require('mongoose');
const { createMethods } = require('@librechat/data-schemas');
const { matchModelName, findMatchingPattern } = require('@librechat/api');
const getLogStores = require('~/cache/getLogStores');

const methods = createMethods(mongoose, {
  matchModelName,
  findMatchingPattern,
  getCache: getLogStores,
});
const {
  AgentReview,
  getAgentReview,
  addOrUpdateReview,
  getLatestReview,
  getVerifiedAgentIds,
  getAllReviews,
  deleteReview,
  deleteAgentReviews,
} = require('./AgentReview');

const seedDatabase = async () => {
  await methods.initializeRoles();
  await methods.seedDefaultRoles();
  await methods.ensureDefaultCategories();
  await methods.seedSystemGrants();
  // Explicit provisioning: MONGO_AUTO_INDEX can disable implicit index
  // creation for the whole connection, which would otherwise silently drop
  // BalanceRequest's partial-unique (dedup) and TTL (retention) guarantees.
  await methods.ensureBalanceRequestIndexes();
  // Same rationale for the Transaction ledger's idempotencyKey unique index.
  await methods.ensureTransactionIdempotencyIndex();
};

module.exports = {
  ...methods,
  seedDatabase,
  AgentReview,
  getAgentReview,
  addOrUpdateReview,
  getLatestReview,
  getVerifiedAgentIds,
  getAllReviews,
  deleteReview,
  deleteAgentReviews,
};
