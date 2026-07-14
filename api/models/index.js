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
