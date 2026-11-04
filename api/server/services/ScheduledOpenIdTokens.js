const openIdClient = require('openid-client');
const { CacheKeys } = require('librechat-data-provider');
const { encryptV2, decryptV2 } = require('@librechat/data-schemas');
const { createScheduledOpenIdTokens, buildOpenIDRefreshParams } = require('@librechat/api');
const { findToken, createToken, deleteTokens } = require('~/models');
const { getOpenIdConfig } = require('~/strategies/openidStrategy');
const { getAppConfig } = require('~/server/services/Config');
const getLogStores = require('~/cache/getLogStores');

module.exports = createScheduledOpenIdTokens({
  isEnabled: async () => {
    const appConfig = await getAppConfig({ baseOnly: true });
    return appConfig?.registration?.openidScheduledTokens === true;
  },
  findToken,
  createToken,
  deleteTokens,
  encrypt: encryptV2,
  decrypt: decryptV2,
  refreshTokenGrant: (refreshToken) =>
    openIdClient.refreshTokenGrant(getOpenIdConfig(), refreshToken, buildOpenIDRefreshParams()),
  cache: getLogStores(CacheKeys.OPENID_EXCHANGED_TOKENS),
});
