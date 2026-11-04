const { createMCPToolSnapshots } = require('@librechat/api');
const { findToken, createToken, deleteTokens } = require('~/models');

module.exports = createMCPToolSnapshots({ findToken, createToken, deleteTokens });
