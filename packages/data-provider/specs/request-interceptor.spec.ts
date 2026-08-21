/**
 * @jest-environment @happy-dom/jest-environment
 */
import axios, { AxiosError } from 'axios';
import type { InternalAxiosRequestConfig } from 'axios';
import { setTokenHeader } from '../src/headers-helpers';

/**
 * The response interceptor in request.ts registers at import time when
 * `typeof window !== 'undefined'` (happy-dom provides window).
 *
 * We use axios's built-in request adapter mock to avoid real HTTP calls,
 * and verify the interceptor's behavior by observing whether a 401 triggers
 * a refresh POST or is immediately rejected.
 *
 * happy-dom is used instead of jsdom because it allows overriding
 * window.location via Object.defineProperty, which jsdom 26+ blocks.
 */

const mockAdapter = jest.fn();
let originalAdapter: typeof axios.defaults.adapter;
let savedLocation: Location;
let savedNavigatorOnlineDescriptor: PropertyDescriptor | undefined;
let dataRequest: typeof import('../src/request').default;

type RetryableAdapterConfig = InternalAxiosRequestConfig & { _retry?: boolean };

function createAdapterResponse(config: InternalAxiosRequestConfig, data: unknown = {}) {
  return Promise.resolve({
    data,
    status: 200,
    headers: {},
    config,
  });
}

function create401Error(config: InternalAxiosRequestConfig) {
  return Promise.reject({
    response: { status: 401 },
    config,
  });
}

function getCallsForUrl(urlPart: string) {
  return mockAdapter.mock.calls.filter(([config]) => config.url?.includes(urlPart) === true);
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function waitForAdapterCall(urlPart: string) {
  for (let i = 0; i < 10; i++) {
    if (getCallsForUrl(urlPart).length > 0) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error(`Adapter was not called for ${urlPart}`);
}

function createJwt(expiresAtMs: number) {
  const payload = Buffer.from(JSON.stringify({ exp: Math.floor(expiresAtMs / 1000) })).toString(
    'base64url',
  );
  return `header.${payload}.signature`;
}

beforeAll(async () => {
  originalAdapter = axios.defaults.adapter;
  axios.defaults.adapter = mockAdapter;

  dataRequest = (await import('../src/request')).default;
});

beforeEach(() => {
  mockAdapter.mockReset();
  savedLocation = window.location;
  savedNavigatorOnlineDescriptor = Object.getOwnPropertyDescriptor(window.navigator, 'onLine');
});

afterAll(() => {
  axios.defaults.adapter = originalAdapter;
});

afterEach(() => {
  delete axios.defaults.headers.common['Authorization'];
  window.localStorage.clear();
  delete (window as Window & { __librechatAuthRecovery?: unknown }).__librechatAuthRecovery;
  Object.defineProperty(window, 'location', {
    value: savedLocation,
    writable: true,
    configurable: true,
  });
  if (savedNavigatorOnlineDescriptor) {
    Object.defineProperty(window.navigator, 'onLine', savedNavigatorOnlineDescriptor);
  } else {
    Reflect.deleteProperty(window.navigator, 'onLine');
  }
});

function setWindowLocation(overrides: Partial<Location>) {
  Object.defineProperty(window, 'location', {
    value: { ...window.location, ...overrides },
    writable: true,
    configurable: true,
  });
}

function setTrackedWindowLocation(overrides: Partial<Location>) {
  let href = overrides.href ?? window.location.href;
  const hrefWrites: string[] = [];
  Object.defineProperty(window, 'location', {
    value: {
      ...window.location,
      ...overrides,
      get href() {
        return href;
      },
      set href(value: string) {
        hrefWrites.push(value);
        href = value;
      },
    },
    writable: true,
    configurable: true,
  });
  return hrefWrites;
}

function setNavigatorOnline(online: boolean) {
  Object.defineProperty(window.navigator, 'onLine', {
    value: online,
    writable: false,
    configurable: true,
  });
}

describe('axios 401 interceptor — Authorization header guard', () => {
  it('skips refresh and rejects when Authorization header is cleared', async () => {
    expect.assertions(1);
    setTokenHeader(undefined);

    mockAdapter.mockRejectedValueOnce({
      response: { status: 401 },
      config: { url: '/api/messages', headers: {} },
    });

    try {
      await axios.get('/api/messages');
    } catch {
      // expected rejection
    }

    expect(mockAdapter).toHaveBeenCalledTimes(1);
  });

  it('attempts refresh on shared link page even without Authorization header', async () => {
    expect.assertions(2);
    setTokenHeader(undefined);

    setWindowLocation({
      href: 'http://localhost/share/abc123',
      pathname: '/share/abc123',
      search: '',
      hash: '',
    } as Partial<Location>);

    mockAdapter.mockRejectedValueOnce({
      response: { status: 401 },
      config: { url: '/api/share/abc123', method: 'get', headers: {} },
    });

    mockAdapter.mockResolvedValueOnce({
      data: { token: 'new-token' },
      status: 200,
      headers: {},
      config: {},
    });

    mockAdapter.mockResolvedValueOnce({
      data: { sharedLink: {} },
      status: 200,
      headers: {},
      config: {},
    });

    try {
      await axios.get('/api/share/abc123');
    } catch {
      // may reject depending on exact flow
    }

    expect(mockAdapter.mock.calls.length).toBe(3);

    const refreshCall = mockAdapter.mock.calls[1];
    expect(refreshCall[0].url).toContain('api/auth/refresh');
  });

  it('attempts refresh for the share fork POST even without Authorization header', async () => {
    expect.assertions(2);
    setTokenHeader(undefined);

    setWindowLocation({
      href: 'http://localhost/share/abc123',
      pathname: '/share/abc123',
      search: '',
      hash: '',
    } as Partial<Location>);

    mockAdapter.mockRejectedValueOnce({
      response: { status: 401 },
      config: { url: '/api/share/abc123/fork', method: 'post', headers: {} },
    });

    mockAdapter.mockResolvedValueOnce({
      data: { token: 'new-token' },
      status: 200,
      headers: {},
      config: {},
    });

    mockAdapter.mockResolvedValueOnce({
      data: { conversation: {}, messages: [] },
      status: 201,
      headers: {},
      config: {},
    });

    try {
      await axios.post('/api/share/abc123/fork');
    } catch {
      // may reject depending on exact flow
    }

    expect(mockAdapter.mock.calls.length).toBe(3);
    expect(mockAdapter.mock.calls[1][0].url).toContain('api/auth/refresh');
  });

  it('does not refresh or redirect for unrelated 401s on public shared link pages', async () => {
    expect.assertions(2);
    setTokenHeader(undefined);

    setWindowLocation({
      href: 'http://localhost/share/abc123',
      pathname: '/share/abc123',
      search: '',
      hash: '',
    } as Partial<Location>);

    mockAdapter.mockRejectedValueOnce({
      response: { status: 401 },
      config: { url: '/api/mcp/servers', headers: {} },
    });

    try {
      await axios.get('/api/mcp/servers');
    } catch {
      // expected rejection
    }

    expect(mockAdapter).toHaveBeenCalledTimes(1);
    expect(window.location.href).toBe('http://localhost/share/abc123');
  });

  it('does not treat nested share routes as public shared link pages', async () => {
    expect.assertions(1);
    setTokenHeader(undefined);

    setWindowLocation({
      href: 'http://localhost/foo/share/abc123',
      pathname: '/foo/share/abc123',
      search: '',
      hash: '',
    } as Partial<Location>);

    mockAdapter.mockRejectedValueOnce({
      response: { status: 401 },
      config: { url: '/api/share/abc123', method: 'get', headers: {} },
    });

    try {
      await axios.get('/api/share/abc123');
    } catch {
      // expected rejection
    }

    expect(mockAdapter).toHaveBeenCalledTimes(1);
  });

  it('does not treat nested API share paths as shared message requests', async () => {
    expect.assertions(1);
    setTokenHeader(undefined);

    setWindowLocation({
      href: 'http://localhost/share/abc123',
      pathname: '/share/abc123',
      search: '',
      hash: '',
    } as Partial<Location>);

    mockAdapter.mockRejectedValueOnce({
      response: { status: 401 },
      config: { url: '/foo/api/share/abc123', method: 'get', headers: {} },
    });

    try {
      await axios.get('/foo/api/share/abc123');
    } catch {
      // expected rejection
    }

    expect(mockAdapter).toHaveBeenCalledTimes(1);
  });

  it('does not bypass guard when share/ appears only in query params', async () => {
    expect.assertions(1);
    setTokenHeader(undefined);

    setWindowLocation({
      href: 'http://localhost/c/chat?ref=share/token',
      pathname: '/c/chat',
      search: '?ref=share/token',
      hash: '',
    } as Partial<Location>);

    mockAdapter.mockRejectedValueOnce({
      response: { status: 401 },
      config: { url: '/api/messages', headers: {} },
    });

    try {
      await axios.get('/api/messages');
    } catch {
      // expected rejection
    }

    expect(mockAdapter).toHaveBeenCalledTimes(1);
  });

  it('redirects to login with redirect_to when unauthenticated on share page and refresh fails', async () => {
    expect.assertions(1);
    setTokenHeader(undefined);

    setWindowLocation({
      href: 'http://localhost/share/abc123',
      pathname: '/share/abc123',
      search: '',
      hash: '',
    } as Partial<Location>);

    mockAdapter.mockRejectedValueOnce({
      response: { status: 401 },
      config: { url: '/api/share/abc123', method: 'get', headers: {} },
    });

    mockAdapter.mockResolvedValueOnce({
      data: { token: '' },
      status: 200,
      headers: {},
      config: {},
    });

    try {
      await axios.get('/api/share/abc123');
    } catch {
      // expected rejection
    }

    expect(window.location.href).toBe('/login?redirect_to=%2Fshare%2Fabc123');
  });

  it('redirects to login when the share fork refresh itself fails (stale session)', async () => {
    expect.assertions(1);
    setTokenHeader(undefined);

    setWindowLocation({
      href: 'http://localhost/share/abc123',
      pathname: '/share/abc123',
      search: '',
      hash: '',
    } as Partial<Location>);

    mockAdapter.mockRejectedValueOnce({
      response: { status: 401 },
      config: { url: '/api/share/abc123/fork', method: 'post', headers: {} },
    });

    mockAdapter.mockRejectedValueOnce({
      response: { status: 403 },
      config: { url: '/api/auth/refresh', method: 'post', headers: {} },
    });

    try {
      await axios.post('/api/share/abc123/fork');
    } catch {
      // expected rejection
    }

    expect(window.location.href).toBe('/login?redirect_to=%2Fshare%2Fabc123');
  });

  it('redirects to login with redirect_to when authenticated and refresh returns no token on share page', async () => {
    expect.assertions(1);
    setTokenHeader('some-token');

    setWindowLocation({
      href: 'http://localhost/share/abc123',
      pathname: '/share/abc123',
      search: '',
      hash: '',
    } as Partial<Location>);

    mockAdapter.mockRejectedValueOnce({
      response: { status: 401 },
      config: { url: '/api/share/abc123', method: 'get', headers: {} },
    });

    mockAdapter.mockResolvedValueOnce({
      data: { token: '' },
      status: 200,
      headers: {},
      config: {},
    });

    try {
      await axios.get('/api/share/abc123');
    } catch {
      // expected rejection
    }

    expect(window.location.href).toBe('/login?redirect_to=%2Fshare%2Fabc123');
  });

  it('redirects to login with redirect_to when refresh returns no token on regular page', async () => {
    expect.assertions(1);
    setTokenHeader('some-token');

    setWindowLocation({
      href: 'http://localhost/c/some-conversation',
      pathname: '/c/some-conversation',
      search: '',
      hash: '',
    } as Partial<Location>);

    mockAdapter.mockRejectedValueOnce({
      response: { status: 401 },
      config: { url: '/api/messages', headers: {} },
    });

    mockAdapter.mockResolvedValueOnce({
      data: { token: '' },
      status: 200,
      headers: {},
      config: {},
    });

    try {
      await axios.get('/api/messages');
    } catch {
      // expected rejection
    }

    expect(window.location.href).toBe('/login?redirect_to=%2Fc%2Fsome-conversation');
  });

  it('redirects to plain /login without redirect_to when already on a login path', async () => {
    expect.assertions(1);
    setTokenHeader('some-token');

    setWindowLocation({
      href: 'http://localhost/login/2fa',
      pathname: '/login/2fa',
      search: '',
      hash: '',
    } as Partial<Location>);

    mockAdapter.mockRejectedValueOnce({
      response: { status: 401 },
      config: { url: '/api/messages', headers: {} },
    });

    mockAdapter.mockResolvedValueOnce({
      data: { token: '' },
      status: 200,
      headers: {},
      config: {},
    });

    try {
      await axios.get('/api/messages');
    } catch {
      // expected rejection
    }

    expect(window.location.href).toBe('/login');
  });

  it('attempts refresh when Authorization header is present', async () => {
    expect.assertions(2);
    setTokenHeader('valid-token');

    mockAdapter.mockRejectedValueOnce({
      response: { status: 401 },
      config: { url: '/api/messages', headers: {}, _retry: false },
    });

    mockAdapter.mockResolvedValueOnce({
      data: { token: 'new-token' },
      status: 200,
      headers: {},
      config: {},
    });

    mockAdapter.mockResolvedValueOnce({
      data: { messages: [] },
      status: 200,
      headers: {},
      config: {},
    });

    try {
      await axios.get('/api/messages');
    } catch {
      // may reject depending on exact flow
    }

    expect(mockAdapter.mock.calls.length).toBe(3);

    const refreshCall = mockAdapter.mock.calls[1];
    expect(refreshCall[0].url).toContain('api/auth/refresh');
  });

  it('coalesces concurrent 401 responses into one refresh and retries with the new token', async () => {
    expect.assertions(3);
    setTokenHeader('expired-token');

    mockAdapter.mockImplementation((config: RetryableAdapterConfig) => {
      if (config.url?.includes('/api/auth/refresh') === true) {
        return createAdapterResponse(config, { token: 'new-token' });
      }
      if (config._retry === true) {
        return createAdapterResponse(config, { ok: true });
      }
      return create401Error(config);
    });

    const responses = await Promise.all([
      axios.get('/api/messages'),
      axios.get('/api/convos'),
      axios.get('/api/files'),
    ]);

    expect(responses.map((response) => response.data)).toEqual([
      { ok: true },
      { ok: true },
      { ok: true },
    ]);

    expect(getCallsForUrl('/api/auth/refresh')).toHaveLength(1);
    expect(
      mockAdapter.mock.calls
        .filter(([config]) => (config as RetryableAdapterConfig)._retry === true)
        .every(([config]) => config.headers?.Authorization === 'Bearer new-token'),
    ).toBe(true);
  });

  it('holds new requests behind an in-flight auth recovery', async () => {
    expect.assertions(4);
    setTokenHeader('expired-token');
    const refresh = createDeferred<string>();

    mockAdapter.mockImplementation((config: RetryableAdapterConfig) => {
      if (config.url?.includes('/api/auth/refresh') === true) {
        return refresh.promise.then((token) => createAdapterResponse(config, { token }));
      }
      if (config.url === '/api/messages' && config._retry !== true) {
        return create401Error(config);
      }
      return createAdapterResponse(config, { ok: true });
    });

    const firstRequest = axios.get('/api/messages');
    await waitForAdapterCall('/api/auth/refresh');

    const secondRequest = axios.get('/api/projects');
    await Promise.resolve();

    expect(getCallsForUrl('/api/projects')).toHaveLength(0);

    refresh.resolve('new-token');
    const responses = await Promise.all([firstRequest, secondRequest]);
    expect(responses.map((response) => response.data)).toEqual([{ ok: true }, { ok: true }]);

    expect(getCallsForUrl('/api/auth/refresh')).toHaveLength(1);
    expect(getCallsForUrl('/api/projects')[0][0].headers?.Authorization).toBe('Bearer new-token');
  });

  it('redirects once when a burst of 401s cannot refresh a token', async () => {
    expect.assertions(3);
    setTokenHeader('expired-token');
    const hrefWrites = setTrackedWindowLocation({
      href: 'http://localhost/c/race',
      pathname: '/c/race',
      search: '',
      hash: '',
    } as Partial<Location>);

    mockAdapter.mockImplementation((config: InternalAxiosRequestConfig) => {
      if (config.url?.includes('/api/auth/refresh') === true) {
        return createAdapterResponse(config, { token: '' });
      }
      return create401Error(config);
    });

    await Promise.allSettled([
      axios.get('/api/messages'),
      axios.get('/api/convos'),
      axios.get('/api/files'),
    ]);

    expect(getCallsForUrl('/api/auth/refresh')).toHaveLength(1);
    expect(hrefWrites).toHaveLength(1);
    expect(hrefWrites[0]).toBe('/login?redirect_to=%2Fc%2Frace');
  });

  it('settles concurrent idle-tab requests and preserves the deep link when the session is gone', async () => {
    setTokenHeader('expired-token');
    const hrefWrites = setTrackedWindowLocation({
      href: 'http://localhost/c/resume?view=chat',
      pathname: '/c/resume',
      search: '?view=chat',
      hash: '',
    });
    const events: string[] = [];
    const listener = (event: Event) => events.push((event as CustomEvent).detail.state);
    window.addEventListener('authRecovery', listener);
    mockAdapter.mockImplementation((config: InternalAxiosRequestConfig) => {
      if (config.url?.includes('/api/auth/refresh') === true) {
        return Promise.reject({
          response: { status: 401, data: { code: 'OPENID_SESSION_MISSING' } },
          config,
        });
      }
      return create401Error(config);
    });
    try {
      const results = await Promise.allSettled([
        axios.get('/api/messages'),
        axios.get('/api/convos'),
        axios.get('/api/files'),
      ]);
      expect(results.every((result) => result.status === 'rejected')).toBe(true);
      expect(getCallsForUrl('/api/auth/refresh')).toHaveLength(1);
      expect(hrefWrites).toEqual(['/login?redirect_to=%2Fc%2Fresume%3Fview%3Dchat']);
      expect(events).toEqual(['started', 'finished']);
    } finally {
      window.removeEventListener('authRecovery', listener);
    }
  });

  it('keeps redirect deduping when the storage timestamp is corrupted', async () => {
    expect.assertions(2);
    setTokenHeader('expired-token');
    const hrefWrites = setTrackedWindowLocation({
      href: 'http://localhost/c/race',
      pathname: '/c/race',
      search: '',
      hash: '',
    } as Partial<Location>);

    mockAdapter.mockImplementation((config: InternalAxiosRequestConfig) => {
      if (config.url?.includes('/api/auth/refresh') === true) {
        return createAdapterResponse(config, { token: '' });
      }
      return create401Error(config);
    });

    await axios.get('/api/messages').catch(() => undefined);
    window.localStorage.setItem('librechat.auth.redirect.startedAt', 'not-a-number');
    await axios.get('/api/convos').catch(() => undefined);

    expect(getCallsForUrl('/api/auth/refresh')).toHaveLength(1);
    expect(hrefWrites).toEqual(['/login?redirect_to=%2Fc%2Frace']);
  });

  it('refreshes a near-expiry bearer token before sending a request', async () => {
    expect.assertions(5);
    setTokenHeader(createJwt(Date.now() + 60_000));

    mockAdapter.mockImplementation((config: InternalAxiosRequestConfig) => {
      if (config.url?.includes('/api/auth/refresh') === true) {
        return createAdapterResponse(config, { token: 'fresh-token' });
      }
      return createAdapterResponse(config, { ok: true });
    });

    const response = await axios.get('/api/messages');

    expect(response.data).toEqual({ ok: true });

    expect(mockAdapter.mock.calls[0][0].url).toContain('/api/auth/refresh');
    expect(mockAdapter.mock.calls[0][0].headers?.Authorization).toBeUndefined();
    expect(mockAdapter.mock.calls[1][0].url).toBe('/api/messages');
    expect(mockAdapter.mock.calls[1][0].headers?.Authorization).toBe('Bearer fresh-token');
  });

  it('refreshes an expired bearer token before sending a request after an inactive tab resumes', async () => {
    expect.assertions(5);
    setTokenHeader(createJwt(Date.now() - 60_000));

    mockAdapter.mockImplementation((config: InternalAxiosRequestConfig) => {
      if (config.url?.includes('/api/auth/refresh') === true) {
        return createAdapterResponse(config, { token: 'fresh-token' });
      }
      return createAdapterResponse(config, { ok: true });
    });

    const response = await axios.post('/api/agents/chat/agents', {});

    expect(response.data).toEqual({ ok: true });
    expect(mockAdapter.mock.calls[0][0].url).toContain('/api/auth/refresh');
    expect(mockAdapter.mock.calls[0][0].headers?.Authorization).toBeUndefined();
    expect(mockAdapter.mock.calls[1][0].url).toBe('/api/agents/chat/agents');
    expect(mockAdapter.mock.calls[1][0].headers?.Authorization).toBe('Bearer fresh-token');
  });

  it('uses shared proactive refresh for authenticated fetch requests', async () => {
    expect.assertions(4);
    setTokenHeader(createJwt(Date.now() + 60_000));

    mockAdapter.mockImplementation((config: InternalAxiosRequestConfig) => {
      if (config.url?.includes('/api/auth/refresh') === true) {
        return createAdapterResponse(config, { token: 'fresh-token' });
      }
      return createAdapterResponse(config, { ok: true });
    });
    const fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(null, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      }),
    );

    await dataRequest.authenticatedFetch('/api/files', {
      method: 'POST',
      body: new FormData(),
      headers: { Accept: 'text/event-stream' },
    });

    expect(getCallsForUrl('/api/auth/refresh')).toHaveLength(1);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const uploadHeaders = new Headers(fetchSpy.mock.calls[0][1]?.headers);
    expect(uploadHeaders.get('Authorization')).toBe('Bearer fresh-token');
    expect(uploadHeaders.get('Accept')).toBe('text/event-stream');
  });

  it('refreshes and retries an authenticated fetch request after a 401', async () => {
    expect.assertions(4);
    setTokenHeader('expired-token');

    mockAdapter.mockImplementation((config: InternalAxiosRequestConfig) => {
      if (config.url?.includes('/api/auth/refresh') === true) {
        return createAdapterResponse(config, { token: 'fresh-token' });
      }
      return createAdapterResponse(config, { ok: true });
    });
    const fetchSpy = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(
        new Response(null, {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        }),
      );

    await dataRequest.authenticatedFetch('/api/files', {
      method: 'POST',
      body: new FormData(),
    });

    expect(getCallsForUrl('/api/auth/refresh')).toHaveLength(1);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const firstHeaders = new Headers(fetchSpy.mock.calls[0][1]?.headers);
    const retriedHeaders = new Headers(fetchSpy.mock.calls[1][1]?.headers);
    expect(firstHeaders.get('Authorization')).toBe('Bearer expired-token');
    expect(retriedHeaders.get('Authorization')).toBe('Bearer fresh-token');
  });

  it('continues with a still-valid token when proactive refresh has an online network failure', async () => {
    expect.assertions(4);
    setTokenHeader(createJwt(Date.now() + 60_000));
    setNavigatorOnline(true);
    const hrefWrites = setTrackedWindowLocation({
      href: 'http://localhost/c/still-valid',
      pathname: '/c/still-valid',
      search: '',
      hash: '',
    } as Partial<Location>);

    mockAdapter.mockImplementation((config: InternalAxiosRequestConfig) => {
      if (config.url?.includes('/api/auth/refresh') === true) {
        return Promise.reject(new AxiosError('Network Error', AxiosError.ERR_NETWORK, config));
      }
      return createAdapterResponse(config, { ok: true });
    });

    const response = await axios.get('/api/messages');

    expect(response.data).toEqual({ ok: true });
    expect(getCallsForUrl('/api/auth/refresh')).toHaveLength(1);
    expect(getCallsForUrl('/api/messages')).toHaveLength(1);
    expect(hrefWrites).toEqual([]);
  });

  it('redirects once when an expired-token refresh fails online without a response', async () => {
    expect.assertions(4);
    setTokenHeader(createJwt(Date.now() - 60_000));
    setNavigatorOnline(true);
    const hrefWrites = setTrackedWindowLocation({
      href: 'http://localhost/c/conversation-123?projectId=test#latest',
      pathname: '/c/conversation-123',
      search: '?projectId=test',
      hash: '#latest',
    } as Partial<Location>);

    mockAdapter.mockImplementation((config: InternalAxiosRequestConfig) => {
      if (config.url?.includes('/api/auth/refresh') === true) {
        return Promise.reject(new AxiosError('Network Error', AxiosError.ERR_NETWORK, config));
      }
      return createAdapterResponse(config, { ok: true });
    });

    await expect(axios.post('/api/agents/chat/bedrock', {})).rejects.toMatchObject({
      code: AxiosError.ERR_NETWORK,
    });
    expect(getCallsForUrl('/api/auth/refresh')).toHaveLength(1);
    expect(getCallsForUrl('/api/agents/chat/bedrock')).toHaveLength(0);
    expect(hrefWrites).toEqual([
      '/login?redirect_to=%2Fc%2Fconversation-123%3FprojectId%3Dtest%23latest',
    ]);
  });

  it('does not redirect when an offline refresh fails without a response', async () => {
    expect.assertions(2);
    setTokenHeader(createJwt(Date.now() - 60_000));
    setNavigatorOnline(false);
    const hrefWrites = setTrackedWindowLocation({
      href: 'http://localhost/c/offline',
      pathname: '/c/offline',
      search: '',
      hash: '',
    } as Partial<Location>);

    mockAdapter.mockImplementation((config: InternalAxiosRequestConfig) => {
      if (config.url?.includes('/api/auth/refresh') === true) {
        return Promise.reject(new AxiosError('Network Error', AxiosError.ERR_NETWORK, config));
      }
      return createAdapterResponse(config, { ok: true });
    });

    await expect(axios.post('/api/agents/chat/bedrock', {})).rejects.toMatchObject({
      code: AxiosError.ERR_NETWORK,
    });
    expect(hrefWrites).toEqual([]);
  });

  it('proactively refreshes when a request query merely mentions an auth endpoint', async () => {
    expect.assertions(2);
    setTokenHeader(createJwt(Date.now() + 60_000));

    mockAdapter.mockImplementation((config: InternalAxiosRequestConfig) => {
      if (config.url?.includes('/api/auth/refresh') === true) {
        return createAdapterResponse(config, { token: createJwt(Date.now() + 60 * 60_000) });
      }
      return createAdapterResponse(config, { ok: true });
    });

    await axios.get('/api/messages?next=/api/auth/logout');
    expect(getCallsForUrl('/api/auth/refresh')).toHaveLength(1);
    expect(getCallsForUrl('/api/messages')).toHaveLength(1);
  });

  it('recoverAuth redirects after an online network failure', async () => {
    expect.assertions(2);
    setTokenHeader(createJwt(Date.now() + 60 * 60_000));
    setNavigatorOnline(true);
    const hrefWrites = setTrackedWindowLocation({
      href: 'http://localhost/c/sse-recovery',
      pathname: '/c/sse-recovery',
      search: '',
      hash: '',
    } as Partial<Location>);

    mockAdapter.mockImplementation((config: InternalAxiosRequestConfig) =>
      Promise.reject(new AxiosError('Network Error', AxiosError.ERR_NETWORK, config)),
    );

    await expect(dataRequest.recoverAuth()).resolves.toEqual({ token: null, redirected: true });
    expect(hrefWrites).toEqual(['/login?redirect_to=%2Fc%2Fsse-recovery']);
  });

  it('recoverAuth keeps offline network failures retryable', async () => {
    expect.assertions(2);
    setTokenHeader(createJwt(Date.now() + 60 * 60_000));
    setNavigatorOnline(false);
    const hrefWrites = setTrackedWindowLocation({
      href: 'http://localhost/c/sse-offline',
      pathname: '/c/sse-offline',
      search: '',
      hash: '',
    } as Partial<Location>);

    mockAdapter.mockImplementation((config: InternalAxiosRequestConfig) =>
      Promise.reject(new AxiosError('Network Error', AxiosError.ERR_NETWORK, config)),
    );

    await expect(dataRequest.recoverAuth()).resolves.toEqual({ token: null, redirected: false });
    expect(hrefWrites).toEqual([]);
  });

  it('recoverAuth does not redirect for a non-auth refresh error', async () => {
    expect.assertions(2);
    setTokenHeader(createJwt(Date.now() + 60 * 60_000));
    const hrefWrites = setTrackedWindowLocation({
      href: 'http://localhost/c/sse-500',
      pathname: '/c/sse-500',
      search: '',
      hash: '',
    } as Partial<Location>);

    mockAdapter.mockImplementation((config: InternalAxiosRequestConfig) =>
      Promise.reject({ response: { status: 500 }, config }),
    );

    await expect(dataRequest.recoverAuth()).resolves.toEqual({ token: null, redirected: false });
    expect(hrefWrites).toEqual([]);
  });

  it.each([401, 403])(
    'redirects to login when proactive refresh rejects the session with %s',
    async (status) => {
      expect.assertions(4);
      setTokenHeader(createJwt(Date.now() - 60_000));
      const hrefWrites = setTrackedWindowLocation({
        href: 'http://localhost/c/inactive-tab',
        pathname: '/c/inactive-tab',
        search: '',
        hash: '',
      } as Partial<Location>);

      mockAdapter.mockImplementation((config: InternalAxiosRequestConfig) => {
        if (config.url?.includes('/api/auth/refresh') === true) {
          return Promise.reject({ response: { status }, config });
        }
        return createAdapterResponse(config, { ok: true });
      });

      await expect(axios.post('/api/agents/chat/agents', {})).rejects.toMatchObject({
        response: { status },
      });
      expect(getCallsForUrl('/api/auth/refresh')).toHaveLength(1);
      expect(getCallsForUrl('/api/agents/chat/agents')).toHaveLength(0);
      expect(hrefWrites).toEqual(['/login?redirect_to=%2Fc%2Finactive-tab']);
    },
  );

  it('redirects when a request gets 401 and its cookie-only refresh also gets 401', async () => {
    expect.assertions(4);
    setTokenHeader('expired-token');
    const hrefWrites = setTrackedWindowLocation({
      href: 'http://localhost/c/inactive-tab',
      pathname: '/c/inactive-tab',
      search: '',
      hash: '',
    } as Partial<Location>);

    mockAdapter.mockImplementation((config: InternalAxiosRequestConfig) => create401Error(config));

    await expect(axios.post('/api/agents/chat/agents', {})).rejects.toMatchObject({
      response: { status: 401 },
    });
    expect(getCallsForUrl('/api/auth/refresh')).toHaveLength(1);
    expect(getCallsForUrl('/api/auth/refresh')[0][0].headers?.Authorization).toBeUndefined();
    expect(hrefWrites).toEqual(['/login?redirect_to=%2Fc%2Finactive-tab']);
  });
});
