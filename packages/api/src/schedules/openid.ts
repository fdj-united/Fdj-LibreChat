import { logger } from '@librechat/data-schemas';
import type { IToken, OIDCTokens, TokenCreateData, TokenQuery } from '@librechat/data-schemas';
import { isScheduleFireRequest } from './trigger';

export const SCHEDULED_OPENID_TOKEN_TYPE = 'openid_scheduled_refresh';
export const SCHEDULED_OPENID_TOKEN_IDENTIFIER = 'openid:scheduled';
/** Matches the Entra ID refresh-token inactivity window; each rotation re-arms it. */
export const DEFAULT_SCHEDULED_OPENID_TOKEN_TTL_SECONDS: number = 90 * 24 * 60 * 60;
const CACHE_EXPIRY_BUFFER_SECONDS = 120;

export type ScheduledOpenIdErrorCode =
  | 'SCHEDULED_OPENID_DISABLED'
  | 'SCHEDULED_OPENID_NOT_STORED'
  | 'SCHEDULED_OPENID_REAUTH_REQUIRED';

export type ScheduledOpenIdResult =
  | { ok: true; value: OIDCTokens }
  | { ok: false; error: { code: ScheduledOpenIdErrorCode } };

interface ScheduledOpenIdTokenSet {
  access_token?: string;
  id_token?: string;
  refresh_token?: string;
  expires_in?: number | string;
}

interface ScheduledOpenIdCache {
  get: (key: string) => Promise<unknown>;
  set: (key: string, value: OIDCTokens, ttlMs: number) => Promise<unknown>;
  delete: (key: string) => Promise<unknown>;
}

export interface ScheduledOpenIdDeps {
  /** Reads the effective `registration.openidScheduledTokens` toggle on every call. */
  isEnabled: () => Promise<boolean>;
  findToken: (query: TokenQuery) => Promise<IToken | null>;
  createToken: (data: TokenCreateData) => Promise<IToken>;
  deleteTokens: (query: TokenQuery) => Promise<unknown>;
  encrypt: (value: string) => Promise<string>;
  decrypt: (value: string) => Promise<string>;
  /** Performs the IdP refresh-token grant with the app's OpenID client config and params. */
  refreshTokenGrant: (refreshToken: string) => Promise<ScheduledOpenIdTokenSet>;
  cache?: ScheduledOpenIdCache;
  ttlSeconds?: number;
}

interface ScheduledOpenIdUser {
  id?: string;
  _id?: { toString: () => string } | string;
  provider?: string;
  openidId?: string;
  federatedTokens?: OIDCTokens;
}

interface ScheduledOpenIdRequest {
  _isAgentTrigger?: boolean;
  _isScheduledFire?: boolean;
  _isManualScheduledFire?: boolean;
  body?: Record<string, unknown>;
  user?: ScheduledOpenIdUser;
}

export interface ScheduledOpenIdTokens {
  save: (userId: string | undefined, refreshToken: string | undefined) => Promise<void>;
  remove: (userId: string) => Promise<void>;
  resolve: (userId: string) => Promise<ScheduledOpenIdResult>;
  hydrate: (req: ScheduledOpenIdRequest) => Promise<ScheduledOpenIdResult | null>;
}

function getUserId(user?: ScheduledOpenIdUser): string | undefined {
  const id = user?.id ?? user?._id;
  return id == null ? undefined : id.toString();
}

function isOpenIdUser(user?: ScheduledOpenIdUser): boolean {
  return user?.provider === 'openid' && user.openidId != null;
}

function hasUsableAccessToken(tokens?: OIDCTokens): boolean {
  if (!tokens?.access_token) {
    return false;
  }
  if (tokens.expires_at == null) {
    return true;
  }
  return Math.floor(Date.now() / 1000) < tokens.expires_at - CACHE_EXPIRY_BUFFER_SECONDS;
}

function toExpiresAt(expiresIn: number | string | undefined): number | undefined {
  const seconds = typeof expiresIn === 'string' ? Number(expiresIn) : expiresIn;
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) {
    return undefined;
  }
  return Math.floor(Date.now() / 1000) + Math.floor(seconds);
}

/** The IdP's OAuth error code (`invalid_grant`, ...) as surfaced by openid-client; absent for transport failures. */
function getOAuthErrorCode(error: unknown): string | undefined {
  const code = (error as { error?: unknown } | null)?.error;
  return typeof code === 'string' && code.length > 0 ? code : undefined;
}

function isCachedTokens(value: unknown): value is OIDCTokens {
  return (
    value != null &&
    typeof value === 'object' &&
    typeof (value as OIDCTokens).access_token === 'string'
  );
}

/**
 * Keeps an encrypted OpenID refresh token per user so scheduled runs, which authenticate with a
 * server-minted trigger JWT and carry no browser session, can still resolve
 * `{{LIBRECHAT_OPENID_*}}` placeholders. The refresh token never leaves this module: it is
 * redeemed server-side and only the short-lived access/ID tokens reach `req.user`.
 */
export function createScheduledOpenIdTokens(deps: ScheduledOpenIdDeps): ScheduledOpenIdTokens {
  const ttlSeconds = deps.ttlSeconds ?? DEFAULT_SCHEDULED_OPENID_TOKEN_TTL_SECONDS;
  const cacheKey = (userId: string) => `scheduled-openid:${userId}`;
  const query = (userId: string): TokenQuery => ({
    userId,
    type: SCHEDULED_OPENID_TOKEN_TYPE,
    identifier: SCHEDULED_OPENID_TOKEN_IDENTIFIER,
  });

  async function remove(userId: string): Promise<void> {
    await Promise.all([deps.deleteTokens(query(userId)), deps.cache?.delete(cacheKey(userId))]);
  }

  async function store(userId: string, refreshToken: string): Promise<void> {
    const token = await deps.encrypt(refreshToken);
    await deps.deleteTokens(query(userId));
    await deps.createToken({
      userId,
      type: SCHEDULED_OPENID_TOKEN_TYPE,
      identifier: SCHEDULED_OPENID_TOKEN_IDENTIFIER,
      token,
      expiresIn: ttlSeconds,
    });
  }

  /** Saves the refresh token from an interactive OpenID login; a no-op when the toggle is off. */
  async function save(userId: string | undefined, refreshToken: string | undefined) {
    if (!userId || !refreshToken || !(await deps.isEnabled())) {
      return;
    }
    await store(userId, refreshToken);
  }

  async function resolve(userId: string): Promise<ScheduledOpenIdResult> {
    if (!(await deps.isEnabled())) {
      return { ok: false, error: { code: 'SCHEDULED_OPENID_DISABLED' } };
    }

    const cached = await deps.cache?.get(cacheKey(userId));
    if (isCachedTokens(cached) && hasUsableAccessToken(cached)) {
      return { ok: true, value: cached };
    }

    const record = await deps.findToken(query(userId));
    if (!record?.token) {
      return { ok: false, error: { code: 'SCHEDULED_OPENID_NOT_STORED' } };
    }

    const refreshToken = await deps.decrypt(record.token);
    let tokenset: ScheduledOpenIdTokenSet;
    try {
      tokenset = await deps.refreshTokenGrant(refreshToken);
    } catch (error) {
      const oauthError = getOAuthErrorCode(error);
      if (!oauthError) {
        throw error;
      }
      logger.warn(
        '[ScheduledOpenId] Refresh grant rejected; the owner must sign in again for scheduled runs',
        { userId, error: oauthError },
      );
      await remove(userId);
      return { ok: false, error: { code: 'SCHEDULED_OPENID_REAUTH_REQUIRED' } };
    }

    if (!tokenset?.access_token) {
      await remove(userId);
      return { ok: false, error: { code: 'SCHEDULED_OPENID_REAUTH_REQUIRED' } };
    }

    if (tokenset.refresh_token && tokenset.refresh_token !== refreshToken) {
      await store(userId, tokenset.refresh_token);
    }

    const tokens: OIDCTokens = {
      access_token: tokenset.access_token,
      id_token: tokenset.id_token,
      expires_at: toExpiresAt(tokenset.expires_in),
    };
    if (deps.cache && tokens.expires_at != null) {
      const ttlMs = (tokens.expires_at - CACHE_EXPIRY_BUFFER_SECONDS) * 1000 - Date.now();
      if (ttlMs > 0) {
        await deps.cache.set(cacheKey(userId), tokens, ttlMs);
      }
    }
    return { ok: true, value: tokens };
  }

  /**
   * Attaches fresh OpenID tokens to a scheduled fire's `req.user`. Leaves the request untouched
   * when it is not a scheduled fire, the owner is not an OpenID user, or no token can be
   * obtained, so placeholder resolution keeps its existing re-authentication failure.
   */
  async function hydrate(req: ScheduledOpenIdRequest): Promise<ScheduledOpenIdResult | null> {
    const user = req.user;
    if (!user || !isScheduleFireRequest(req) || !isOpenIdUser(user)) {
      return null;
    }
    if (hasUsableAccessToken(user.federatedTokens)) {
      return null;
    }
    const userId = getUserId(user);
    if (!userId) {
      return null;
    }
    const result = await resolve(userId);
    if (result.ok) {
      user.federatedTokens = result.value;
    }
    return result;
  }

  return { save, remove, resolve, hydrate };
}
