jest.mock('@librechat/api', () => ({
  isEnabled: jest.fn(),
  instrumentMongooseQueryMetrics: jest.fn(),
}));

jest.mock('@librechat/data-schemas', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

const ORIGINAL_ENV = { ...process.env };

const TEST_URI = 'mongodb://127.0.0.1:27017/LibreChat';

function loadConnectDb({ uri = TEST_URI, env = {}, clientOptions = {} } = {}) {
  let connectDb;
  let connectSpy;
  let loggerInfo;

  jest.isolateModules(() => {
    process.env.MONGO_URI = uri;
    for (const [key, value] of Object.entries(env)) {
      process.env[key] = value;
    }

    const mongoose = require('mongoose');
    connectSpy = jest.spyOn(mongoose, 'connect').mockResolvedValue(mongoose);
    jest.spyOn(mongoose.connection, 'getClient').mockReturnValue({ options: clientOptions });
    loggerInfo = require('@librechat/data-schemas').logger.info;

    ({ connectDb } = require('./connect'));
  });

  return { connectDb, connectSpy, loggerInfo };
}

const getConnectOptions = (connectSpy) => connectSpy.mock.calls[0][1];

const getLogLine = (loggerInfo, prefix) =>
  loggerInfo.mock.calls
    .map((call) => call[0])
    .find((message) => typeof message === 'string' && message.startsWith(prefix));

describe('connectDb Mongo timeout overrides', () => {
  beforeEach(() => {
    delete global.mongoose;
    process.env = { ...ORIGINAL_ENV };
    delete process.env.MONGO_SOCKET_TIMEOUT_MS;
    delete process.env.MONGO_CONNECT_TIMEOUT_MS;
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  it('passes positive overrides to the driver', async () => {
    const { connectDb, connectSpy } = loadConnectDb({
      env: { MONGO_SOCKET_TIMEOUT_MS: '60000', MONGO_CONNECT_TIMEOUT_MS: '10000' },
    });

    await connectDb();

    expect(getConnectOptions(connectSpy)).toMatchObject({
      socketTimeoutMS: 60000,
      connectTimeoutMS: 10000,
    });
  });

  it('preserves zero so a URI-configured timeout can be disabled', async () => {
    const { connectDb, connectSpy } = loadConnectDb({
      env: { MONGO_SOCKET_TIMEOUT_MS: '0', MONGO_CONNECT_TIMEOUT_MS: '0' },
    });

    await connectDb();

    expect(getConnectOptions(connectSpy)).toMatchObject({
      socketTimeoutMS: 0,
      connectTimeoutMS: 0,
    });
  });

  it('omits the options when the env vars are unset', async () => {
    const { connectDb, connectSpy } = loadConnectDb();

    await connectDb();

    const options = getConnectOptions(connectSpy);
    expect(options).not.toHaveProperty('socketTimeoutMS');
    expect(options).not.toHaveProperty('connectTimeoutMS');
  });

  it('omits the options when the env vars are empty', async () => {
    const { connectDb, connectSpy } = loadConnectDb({
      env: { MONGO_SOCKET_TIMEOUT_MS: '', MONGO_CONNECT_TIMEOUT_MS: ' ' },
    });

    await connectDb();

    const options = getConnectOptions(connectSpy);
    expect(options).not.toHaveProperty('socketTimeoutMS');
    expect(options).not.toHaveProperty('connectTimeoutMS');
  });

  it.each([['abc'], ['-5000'], ['12.5'], ['60000ms']])(
    'fails startup for invalid MONGO_SOCKET_TIMEOUT_MS value %p',
    (value) => {
      expect(() => loadConnectDb({ env: { MONGO_SOCKET_TIMEOUT_MS: value } })).toThrow(
        `Invalid MONGO_SOCKET_TIMEOUT_MS value: "${value}"`,
      );
    },
  );

  it('fails startup for an invalid MONGO_CONNECT_TIMEOUT_MS value', () => {
    expect(() => loadConnectDb({ env: { MONGO_CONNECT_TIMEOUT_MS: '10s' } })).toThrow(
      'Invalid MONGO_CONNECT_TIMEOUT_MS value: "10s"',
    );
  });

  it('logs whitelisted URI driver params without credentials', async () => {
    const { connectDb, loggerInfo } = loadConnectDb({
      uri:
        'mongodb://librechat-app:secret-password@127.0.0.1:27017/LibreChat' +
        '?socketTimeoutMS=6000&connectTimeoutMS=6000&readPreference=secondaryPreferred&authSource=admin',
    });

    await connectDb();

    const uriLog = getLogLine(loggerInfo, 'MONGO_URI driver params:');
    expect(uriLog).toBeDefined();
    expect(uriLog).toContain('"socketTimeoutMS":"6000"');
    expect(uriLog).toContain('"readPreference":"secondaryPreferred"');
    expect(uriLog).not.toContain('secret-password');
    expect(uriLog).not.toContain('authSource');
  });

  it('skips the URI params log when the URI declares no diagnostic params', async () => {
    const { connectDb, loggerInfo } = loadConnectDb();

    await connectDb();

    expect(getLogLine(loggerInfo, 'MONGO_URI driver params:')).toBeUndefined();
  });

  it('logs the resolved driver options after connecting', async () => {
    const { connectDb, loggerInfo } = loadConnectDb({
      env: { MONGO_SOCKET_TIMEOUT_MS: '60000' },
      clientOptions: {
        socketTimeoutMS: 60000,
        connectTimeoutMS: 10000,
        retryReads: true,
        retryWrites: true,
        readPreference: { mode: 'secondaryPreferred' },
      },
    });

    await connectDb();

    const resolvedLog = getLogLine(loggerInfo, 'Mongo resolved driver options:');
    expect(resolvedLog).toBeDefined();
    expect(resolvedLog).toContain('"socketTimeoutMS":60000');
    expect(resolvedLog).toContain('"connectTimeoutMS":10000');
    expect(resolvedLog).toContain('"retryReads":true');
    expect(resolvedLog).toContain('"readPreference":"secondaryPreferred"');
  });
});
