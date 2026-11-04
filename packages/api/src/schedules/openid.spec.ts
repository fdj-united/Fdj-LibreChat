import mongoose, { Types } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createModels, createMethods } from '@librechat/data-schemas';
import type { OIDCTokens } from '@librechat/data-schemas';
import type { ScheduledOpenIdDeps } from './openid';
import { createScheduledOpenIdTokens, SCHEDULED_OPENID_TOKEN_TYPE } from './openid';

let mongo: MongoMemoryServer;
let methods: ReturnType<typeof createMethods>;

const encrypt = async (value: string) => `enc:${Buffer.from(value).toString('base64')}`;
const decrypt = async (value: string) =>
  Buffer.from(value.replace(/^enc:/, ''), 'base64').toString();

function createMemoryCache() {
  const store = new Map<string, OIDCTokens>();
  return {
    store,
    get: async (key: string) => store.get(key),
    set: async (key: string, value: OIDCTokens) => store.set(key, value),
    delete: async (key: string) => store.delete(key),
  };
}

function setup(overrides: Partial<ScheduledOpenIdDeps> = {}) {
  const cache = createMemoryCache();
  const refreshTokenGrant = jest.fn<ReturnType<ScheduledOpenIdDeps['refreshTokenGrant']>, [string]>(
    async () => ({
      access_token: 'fresh-access',
      id_token: 'fresh-id',
      refresh_token: 'rotated-refresh',
      expires_in: 3600,
    }),
  );
  const service = createScheduledOpenIdTokens({
    isEnabled: async () => true,
    findToken: methods.findToken,
    createToken: methods.createToken,
    deleteTokens: methods.deleteTokens,
    encrypt,
    decrypt,
    refreshTokenGrant,
    cache,
    ...overrides,
  });
  return { service, cache, refreshTokenGrant };
}

interface TestUser {
  id: string;
  provider?: string;
  openidId?: string;
  federatedTokens?: OIDCTokens;
}

function scheduledRequest(userId: string, user: Partial<TestUser> = {}) {
  const testUser: TestUser = { id: userId, provider: 'openid', openidId: 'oid-1', ...user };
  return { _isScheduledFire: true, user: testUser };
}

async function storedRecord(userId: string) {
  return methods.findToken({ userId, type: SCHEDULED_OPENID_TOKEN_TYPE });
}

beforeAll(async () => {
  mongo = await MongoMemoryServer.create({ instance: { args: ['--nounixsocket'] } });
  await mongoose.connect(mongo.getUri());
  createModels(mongoose);
  methods = createMethods(mongoose);
});

afterEach(async () => {
  await mongoose.models.Token.deleteMany({});
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

describe('createScheduledOpenIdTokens', () => {
  it('stores the refresh token encrypted and replaces the previous one', async () => {
    const userId = new Types.ObjectId().toString();
    const { service } = setup();

    await service.save(userId, 'refresh-1');
    await service.save(userId, 'refresh-2');

    const records = await mongoose.models.Token.find({ type: SCHEDULED_OPENID_TOKEN_TYPE });
    expect(records).toHaveLength(1);
    expect(records[0].token).not.toContain('refresh-2');
    expect(await decrypt(records[0].token)).toBe('refresh-2');
  });

  it('does not store anything when the toggle is off', async () => {
    const userId = new Types.ObjectId().toString();
    const { service } = setup({ isEnabled: async () => false });

    await service.save(userId, 'refresh-1');

    expect(await storedRecord(userId)).toBeNull();
  });

  it('hydrates a scheduled fire with refreshed tokens and persists the rotated refresh token', async () => {
    const userId = new Types.ObjectId().toString();
    const { service, refreshTokenGrant } = setup();
    await service.save(userId, 'refresh-1');
    const req = scheduledRequest(userId);

    const result = await service.hydrate(req);

    expect(result).toEqual({ ok: true, value: expect.any(Object) });
    expect(refreshTokenGrant).toHaveBeenCalledWith('refresh-1');
    expect(req.user.federatedTokens).toMatchObject({
      access_token: 'fresh-access',
      id_token: 'fresh-id',
    });
    expect(req.user.federatedTokens).not.toHaveProperty('refresh_token');
    const record = await storedRecord(userId);
    expect(await decrypt(record!.token)).toBe('rotated-refresh');
  });

  it('reuses the cached access token instead of refreshing again', async () => {
    const userId = new Types.ObjectId().toString();
    const { service, refreshTokenGrant } = setup();
    await service.save(userId, 'refresh-1');

    await service.hydrate(scheduledRequest(userId));
    const second = scheduledRequest(userId);
    await service.hydrate(second);

    expect(refreshTokenGrant).toHaveBeenCalledTimes(1);
    expect(second.user.federatedTokens).toMatchObject({ access_token: 'fresh-access' });
  });

  it('leaves interactive and non-OpenID requests untouched', async () => {
    const userId = new Types.ObjectId().toString();
    const { service, refreshTokenGrant } = setup();
    await service.save(userId, 'refresh-1');

    const interactive = { user: { id: userId, provider: 'openid', openidId: 'oid-1' } };
    const local = scheduledRequest(userId, { provider: 'local', openidId: undefined });

    expect(await service.hydrate(interactive)).toBeNull();
    expect(await service.hydrate(local)).toBeNull();
    expect(refreshTokenGrant).not.toHaveBeenCalled();
  });

  it('keeps a still-valid token already on the request', async () => {
    const userId = new Types.ObjectId().toString();
    const { service, refreshTokenGrant } = setup();
    const expiresAt = Math.floor(Date.now() / 1000) + 3600;
    const req = scheduledRequest(userId, {
      federatedTokens: { access_token: 'live', expires_at: expiresAt },
    });

    expect(await service.hydrate(req)).toBeNull();
    expect(refreshTokenGrant).not.toHaveBeenCalled();
  });

  it('reports a missing token without touching the request', async () => {
    const userId = new Types.ObjectId().toString();
    const { service } = setup();
    const req = scheduledRequest(userId);

    const result = await service.hydrate(req);

    expect(result).toEqual({ ok: false, error: { code: 'SCHEDULED_OPENID_NOT_STORED' } });
    expect(req.user).not.toHaveProperty('federatedTokens');
  });

  it('deletes the stored token and requires sign-in when the IdP rejects the grant', async () => {
    const userId = new Types.ObjectId().toString();
    const { service } = setup({
      refreshTokenGrant: async () => {
        throw Object.assign(new Error('rejected'), { error: 'invalid_grant' });
      },
    });
    await service.save(userId, 'refresh-1');

    const result = await service.hydrate(scheduledRequest(userId));

    expect(result).toEqual({ ok: false, error: { code: 'SCHEDULED_OPENID_REAUTH_REQUIRED' } });
    expect(await storedRecord(userId)).toBeNull();
  });

  it('keeps the stored token when the IdP is unreachable', async () => {
    const userId = new Types.ObjectId().toString();
    const { service } = setup({
      refreshTokenGrant: async () => {
        throw new Error('fetch failed');
      },
    });
    await service.save(userId, 'refresh-1');

    await expect(service.hydrate(scheduledRequest(userId))).rejects.toThrow('fetch failed');
    expect(await storedRecord(userId)).not.toBeNull();
  });

  it('ignores stored tokens once the toggle is turned off', async () => {
    const userId = new Types.ObjectId().toString();
    let enabled = true;
    const { service, refreshTokenGrant } = setup({ isEnabled: async () => enabled });
    await service.save(userId, 'refresh-1');
    enabled = false;

    const result = await service.hydrate(scheduledRequest(userId));

    expect(result).toEqual({ ok: false, error: { code: 'SCHEDULED_OPENID_DISABLED' } });
    expect(refreshTokenGrant).not.toHaveBeenCalled();
  });

  it('removes the stored token and cached access token on logout', async () => {
    const userId = new Types.ObjectId().toString();
    const { service, cache } = setup();
    await service.save(userId, 'refresh-1');
    await service.hydrate(scheduledRequest(userId));

    await service.remove(userId);

    expect(await storedRecord(userId)).toBeNull();
    expect(cache.store.size).toBe(0);
  });
});
