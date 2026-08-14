/* eslint-disable @typescript-eslint/no-explicit-any */
import axios, { AxiosHeaders } from 'axios';
import type { AxiosRequestConfig, InternalAxiosRequestConfig } from 'axios';
import type * as t from './types';
import { setTokenHeader } from './headers-helpers';
import * as endpoints from './api-endpoints';

async function _get<T>(url: string, options?: AxiosRequestConfig): Promise<T> {
  const response = await axios.get(url, { ...options });
  return response.data;
}

async function _getResponse<T>(url: string, options?: AxiosRequestConfig): Promise<T> {
  return await axios.get(url, { ...options });
}

async function _post(url: string, data?: any) {
  const response = await axios.post(url, JSON.stringify(data), {
    headers: { 'Content-Type': 'application/json' },
  });
  return response.data;
}

async function _postMultiPart(url: string, formData: FormData, options?: AxiosRequestConfig) {
  const response = await axios.post(url, formData, {
    ...options,
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return response.data;
}

async function _postTTS(url: string, formData: FormData, options?: AxiosRequestConfig) {
  const response = await axios.post(url, formData, {
    ...options,
    headers: { 'Content-Type': 'multipart/form-data' },
    responseType: 'arraybuffer',
  });
  return response.data;
}

async function _put(url: string, data?: any) {
  const response = await axios.put(url, JSON.stringify(data), {
    headers: { 'Content-Type': 'application/json' },
  });
  return response.data;
}

async function _delete<T>(url: string): Promise<T> {
  const response = await axios.delete(url);
  return response.data;
}

async function _deleteWithOptions<T>(url: string, options?: AxiosRequestConfig): Promise<T> {
  const response = await axios.delete(url, { ...options });
  return response.data;
}

async function _patch(url: string, data?: any) {
  const response = await axios.patch(url, JSON.stringify(data), {
    headers: { 'Content-Type': 'application/json' },
  });
  return response.data;
}

const AUTH_RECOVERY_EVENT = 'authRecovery';
const AUTH_REDIRECT_EVENT = 'authRedirectStarted';
const AUTH_REDIRECT_STORAGE_KEY = 'librechat.auth.redirect.startedAt';
const AUTH_REDIRECT_DEDUPE_MS = 15_000;
const TOKEN_REFRESH_BUFFER_MS = 2 * 60 * 1000;

type RetryableAxiosRequestConfig = AxiosRequestConfig & { _retry?: boolean };

type AuthRecoveryState = {
  lastRedirectStartedAt: number;
  refreshPromise: Promise<string | null> | null;
};

type AuthRecoveryWindow = Window & {
  __librechatAuthRecovery?: AuthRecoveryState;
};

const refreshToken = (retry?: boolean): Promise<t.TRefreshTokenResponse | undefined> =>
  _post(endpoints.refreshToken(retry));

const SHARE_PAGE_PATH_REGEX = /^\/share\/[^/]+\/?$/;
const SHARED_MESSAGES_PATH_REGEX = /^\/api\/share\/[^/]+$/;

const normalizePathname = (pathname: string) =>
  pathname.startsWith('/') ? pathname : `/${pathname}`;

const stripBasePath = (pathname: string) => {
  const normalizedPathname = normalizePathname(pathname);
  const baseUrl = endpoints.apiBaseUrl();
  if (!baseUrl) {
    return normalizedPathname;
  }

  const normalizedBaseUrl = normalizePathname(baseUrl);
  if (
    normalizedPathname === normalizedBaseUrl ||
    normalizedPathname.startsWith(`${normalizedBaseUrl}/`)
  ) {
    return normalizedPathname.slice(normalizedBaseUrl.length) || '/';
  }
  return normalizedPathname;
};

const isSharePage = () => SHARE_PAGE_PATH_REGEX.test(stripBasePath(window.location.pathname));

const getRequestPathname = (url?: string) => {
  if (typeof url !== 'string') {
    return '';
  }
  try {
    return new URL(url, window.location.origin).pathname;
  } catch {
    return url.split(/[?#]/)[0] ?? '';
  }
};

const isSharedMessagesRequest = (url?: string, method?: string) =>
  method?.toLowerCase() === 'get' &&
  SHARED_MESSAGES_PATH_REGEX.test(stripBasePath(getRequestPathname(url)));

const dispatchTokenUpdatedEvent = (token: string) => {
  setTokenHeader(token);
  clearAuthRedirectStartedAt();
  window.dispatchEvent(new CustomEvent('tokenUpdated', { detail: token }));
};

const getAuthRecoveryState = (): AuthRecoveryState => {
  const browserWindow = window as AuthRecoveryWindow;
  browserWindow.__librechatAuthRecovery ??= {
    lastRedirectStartedAt: 0,
    refreshPromise: null,
  };
  return browserWindow.__librechatAuthRecovery;
};

const getAuthRedirectStartedAt = () => {
  const state = getAuthRecoveryState();
  try {
    const startedAt = window.localStorage.getItem(AUTH_REDIRECT_STORAGE_KEY);
    const storedStartedAt = startedAt != null ? Number(startedAt) : 0;
    const finiteStartedAt = Number.isFinite(storedStartedAt) ? storedStartedAt : 0;
    return Math.max(finiteStartedAt, state.lastRedirectStartedAt);
  } catch {
    return state.lastRedirectStartedAt;
  }
};

const setAuthRedirectStartedAt = () => {
  const state = getAuthRecoveryState();
  state.lastRedirectStartedAt = Date.now();
  try {
    window.localStorage.setItem(AUTH_REDIRECT_STORAGE_KEY, String(state.lastRedirectStartedAt));
  } catch {
    // localStorage can be blocked in embedded/private contexts.
  }
};

const clearAuthRedirectStartedAt = () => {
  const state = getAuthRecoveryState();
  state.lastRedirectStartedAt = 0;
  try {
    window.localStorage.removeItem(AUTH_REDIRECT_STORAGE_KEY);
  } catch {
    // Ignore unavailable storage.
  }
};

const isAuthRedirectInProgress = () => {
  const startedAt = getAuthRedirectStartedAt();
  return (
    Number.isFinite(startedAt) && startedAt > 0 && Date.now() - startedAt < AUTH_REDIRECT_DEDUPE_MS
  );
};

const dispatchAuthRecoveryEvent = (state: 'started' | 'finished') => {
  window.dispatchEvent(new CustomEvent(AUTH_RECOVERY_EVENT, { detail: { state } }));
};

const setRequestAuthorizationHeader = (config: AxiosRequestConfig, token: string) => {
  const headers = (config.headers ?? {}) as Record<string, string>;
  headers['Authorization'] = `Bearer ${token}`;
  config.headers = headers;
};

const clearRequestAuthorizationHeader = (config: InternalAxiosRequestConfig) => {
  const headers = AxiosHeaders.from(config.headers as AxiosHeaders);
  headers.delete('Authorization');
  config.headers = headers;
};

const isRefreshRequest = (url?: string) => url?.includes('/api/auth/refresh') === true;

const isAuthRecoveryEndpoint = (url?: string) =>
  url?.includes('/api/auth/2fa') === true ||
  url?.includes('/api/auth/logout') === true ||
  isRefreshRequest(url);

const startAuthRecovery = (retryRefresh?: boolean) => {
  const state = getAuthRecoveryState();
  if (state.refreshPromise) {
    return state.refreshPromise;
  }

  dispatchAuthRecoveryEvent('started');
  state.refreshPromise = refreshToken(retryRefresh)
    .then((response) => {
      const token = response?.token ?? '';
      if (!token) {
        return null;
      }
      dispatchTokenUpdatedEvent(token);
      return token;
    })
    .finally(() => {
      state.refreshPromise = null;
      dispatchAuthRecoveryEvent('finished');
    });

  return state.refreshPromise;
};

const redirectToLoginOnce = () => {
  if (isAuthRedirectInProgress()) {
    return;
  }

  const href = endpoints.apiBaseUrl() + endpoints.buildLoginRedirectUrl();
  setTokenHeader(undefined);
  setAuthRedirectStartedAt();
  window.dispatchEvent(new CustomEvent(AUTH_REDIRECT_EVENT, { detail: { href } }));
  window.location.href = href;
};

const getBearerToken = () => {
  const authorization = axios.defaults.headers.common['Authorization'];
  if (typeof authorization !== 'string' || !authorization.startsWith('Bearer ')) {
    return null;
  }
  return authorization.slice('Bearer '.length);
};

const getJwtExpiryMs = (token: string) => {
  const payload = token.split('.')[1];
  if (!payload) {
    return null;
  }

  try {
    const normalizedPayload = payload.replace(/-/g, '+').replace(/_/g, '/');
    const paddedPayload = normalizedPayload.padEnd(
      normalizedPayload.length + ((4 - (normalizedPayload.length % 4)) % 4),
      '=',
    );
    const decodedPayload = JSON.parse(window.atob(paddedPayload)) as { exp?: number };
    return typeof decodedPayload.exp === 'number' ? decodedPayload.exp * 1000 : null;
  } catch {
    return null;
  }
};

const getBearerTokenTimeUntilExpiry = () => {
  const token = getBearerToken();
  if (!token) {
    return null;
  }

  const expiresAt = getJwtExpiryMs(token);
  return expiresAt == null ? null : expiresAt - Date.now();
};

const getResponseStatus = (error: unknown) => {
  if (typeof error !== 'object' || error == null || !('response' in error)) {
    return null;
  }

  const response = (error as { response?: { status?: number } }).response;
  return typeof response?.status === 'number' ? response.status : null;
};

const isRejectedRefreshSession = (error: unknown) => {
  const status = getResponseStatus(error);
  return status === 401 || status === 403;
};

const shouldRefreshBeforeRequest = (url?: string) => {
  if (isAuthRecoveryEndpoint(url) || isAuthRedirectInProgress()) {
    return false;
  }

  const timeUntilExpiry = getBearerTokenTimeUntilExpiry();
  return timeUntilExpiry != null && timeUntilExpiry <= TOKEN_REFRESH_BUFFER_MS;
};

const recoverRequestAuthorization = async (
  config: InternalAxiosRequestConfig,
  recovery: Promise<string | null>,
) => {
  try {
    const token = await recovery;
    if (token) {
      setRequestAuthorizationHeader(config, token);
      return config;
    }

    redirectToLoginOnce();
    return Promise.reject(new Error('Authentication refresh returned no token'));
  } catch (error) {
    if (isRejectedRefreshSession(error)) {
      redirectToLoginOnce();
      return Promise.reject(error);
    }

    const timeUntilExpiry = getBearerTokenTimeUntilExpiry();
    if (timeUntilExpiry != null && timeUntilExpiry <= 0) {
      return Promise.reject(error);
    }
  }

  return config;
};

if (typeof window !== 'undefined') {
  axios.interceptors.request.use(async (config) => {
    if (isRefreshRequest(config.url)) {
      clearRequestAuthorizationHeader(config);
      return config;
    }

    const state = getAuthRecoveryState();
    if (state.refreshPromise && !isAuthRecoveryEndpoint(config.url)) {
      return recoverRequestAuthorization(config, state.refreshPromise);
    }

    if (!shouldRefreshBeforeRequest(config.url)) {
      return config;
    }

    return recoverRequestAuthorization(config, startAuthRecovery(false));
  });

  axios.interceptors.response.use(
    (response) => response,
    async (error) => {
      const originalRequest = error.config as RetryableAxiosRequestConfig | undefined;
      if (!error.response) {
        return Promise.reject(error);
      }
      if (!originalRequest) {
        return Promise.reject(error);
      }

      const originalIsRefreshRequest = isRefreshRequest(originalRequest.url);
      if (isAuthRecoveryEndpoint(originalRequest.url) && !originalIsRefreshRequest) {
        return Promise.reject(error);
      }

      if (originalIsRefreshRequest && getAuthRecoveryState().refreshPromise) {
        return Promise.reject(error);
      }

      /** Skip refresh when the Authorization header has been cleared (e.g. during logout),
       *  but allow the shared link data request to proceed so private shares can still
       *  recover auth/redirect without unrelated share-page queries forcing login. */
      if (
        !axios.defaults.headers.common['Authorization'] &&
        !(isSharePage() && isSharedMessagesRequest(originalRequest.url, originalRequest.method))
      ) {
        return Promise.reject(error);
      }

      if (isAuthRedirectInProgress()) {
        return Promise.reject(error);
      }

      if (error.response.status === 401 && !originalRequest._retry) {
        const hasActiveRecovery = getAuthRecoveryState().refreshPromise != null;
        if (!hasActiveRecovery) {
          console.warn('401 error, refreshing token');
        }
        originalRequest._retry = true;

        try {
          const token = await startAuthRecovery(
            // Handle edge case where we get a blank screen if the initial 401 error is from a refresh token request
            originalIsRefreshRequest,
          );

          if (token) {
            setRequestAuthorizationHeader(originalRequest, token);
            return await axios(originalRequest);
          }

          redirectToLoginOnce();
          return Promise.reject(error);
        } catch (err) {
          if (isRejectedRefreshSession(err)) {
            redirectToLoginOnce();
          }
          return Promise.reject(err);
        }
      }

      return Promise.reject(error);
    },
  );
}

export default {
  get: _get,
  getResponse: _getResponse,
  post: _post,
  postMultiPart: _postMultiPart,
  postTTS: _postTTS,
  put: _put,
  delete: _delete,
  deleteWithOptions: _deleteWithOptions,
  patch: _patch,
  refreshToken,
  dispatchTokenUpdatedEvent,
};
