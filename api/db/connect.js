require('dotenv').config();
const { isEnabled, instrumentMongooseQueryMetrics } = require('@librechat/api');
const { logger } = require('@librechat/data-schemas');

const mongoose = require('mongoose');
const MONGO_URI = process.env.MONGO_URI;

instrumentMongooseQueryMetrics(mongoose);

if (!MONGO_URI) {
  throw new Error('Please define the MONGO_URI environment variable');
}
/** Parses a non-negative integer duration in milliseconds from the named env var. Unset/empty returns undefined; a malformed explicit value fails startup so the URI-configured timeout is never silently kept. Zero is preserved — the driver treats 0 as "disable the timeout". */
const parseNonNegativeMs = (name) => {
  const value = process.env[name];
  if (value == null || value.trim() === '') {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(
      `Invalid ${name} value: "${value}". Expected a non-negative integer in milliseconds.`,
    );
  }
  return parsed;
};
/** The maximum number of connections in the connection pool. */
const maxPoolSize = parseInt(process.env.MONGO_MAX_POOL_SIZE) || undefined;
/** The minimum number of connections in the connection pool. */
const minPoolSize = parseInt(process.env.MONGO_MIN_POOL_SIZE) || undefined;
/** The maximum number of connections that may be in the process of being established concurrently by the connection pool. */
const maxConnecting = parseInt(process.env.MONGO_MAX_CONNECTING) || undefined;
/** The maximum number of milliseconds that a connection can remain idle in the pool before being removed and closed. */
const maxIdleTimeMS = parseInt(process.env.MONGO_MAX_IDLE_TIME_MS) || undefined;
/** The maximum time in milliseconds that a thread can wait for a connection to become available. */
const waitQueueTimeoutMS = parseInt(process.env.MONGO_WAIT_QUEUE_TIMEOUT_MS) || undefined;
/** The maximum time in milliseconds to attempt a send or receive on a socket before timing out. Takes precedence over `socketTimeoutMS` in `MONGO_URI`; 0 disables the timeout. */
const socketTimeoutMS = parseNonNegativeMs('MONGO_SOCKET_TIMEOUT_MS');
/** The maximum time in milliseconds to establish a single TCP/TLS connection before timing out. Takes precedence over `connectTimeoutMS` in `MONGO_URI`; 0 disables the timeout. */
const connectTimeoutMS = parseNonNegativeMs('MONGO_CONNECT_TIMEOUT_MS');
/** Set to false to disable automatic index creation for all models associated with this connection. */
const autoIndex =
  process.env.MONGO_AUTO_INDEX != undefined
    ? isEnabled(process.env.MONGO_AUTO_INDEX) || false
    : undefined;

/** Set to `false` to disable Mongoose automatically calling `createCollection()` on every model created on this connection. */
const autoCreate =
  process.env.MONGO_AUTO_CREATE != undefined
    ? isEnabled(process.env.MONGO_AUTO_CREATE) || false
    : undefined;
/**
 * Global is used here to maintain a cached connection across hot reloads
 * in development. This prevents connections growing exponentially
 * during API Route usage.
 */
let cached = global.mongoose;

if (!cached) {
  cached = global.mongoose = { conn: null, promise: null };
}

mongoose.connection.on('error', (err) => {
  logger.error('[connectDb] MongoDB connection error:', err);
});

const URI_DIAGNOSTIC_PARAMS = new Set([
  'sockettimeoutms',
  'connecttimeoutms',
  'retryreads',
  'retrywrites',
  'readpreference',
]);

/** Extracts timeout/retry-related query params declared in the connection string for startup diagnostics; never includes credentials. */
function getUriDriverParams(uri) {
  const queryIndex = uri.indexOf('?');
  if (queryIndex === -1) {
    return {};
  }
  const declared = {};
  for (const [key, value] of new URLSearchParams(uri.slice(queryIndex + 1))) {
    if (URI_DIAGNOSTIC_PARAMS.has(key.toLowerCase())) {
      declared[key] = value;
    }
  }
  return declared;
}

/** Logs the driver's effective timeout/retry settings after URI params and explicit options are merged. */
function logResolvedDriverOptions(mongooseInstance) {
  const clientOptions = mongooseInstance.connection.getClient().options;
  logger.info(
    `Mongo resolved driver options: ${JSON.stringify({
      socketTimeoutMS: clientOptions.socketTimeoutMS,
      connectTimeoutMS: clientOptions.connectTimeoutMS,
      retryReads: clientOptions.retryReads,
      retryWrites: clientOptions.retryWrites,
      readPreference: clientOptions.readPreference?.mode,
    })}`,
  );
}

async function connectDb() {
  if (cached.conn && cached.conn?._readyState === 1) {
    return cached.conn;
  }

  const disconnected = cached.conn && cached.conn?._readyState !== 1;
  if (!cached.promise || disconnected) {
    const opts = {
      bufferCommands: false,
      ...(maxPoolSize ? { maxPoolSize } : {}),
      ...(minPoolSize ? { minPoolSize } : {}),
      ...(maxConnecting ? { maxConnecting } : {}),
      ...(maxIdleTimeMS ? { maxIdleTimeMS } : {}),
      ...(waitQueueTimeoutMS ? { waitQueueTimeoutMS } : {}),
      ...(socketTimeoutMS !== undefined ? { socketTimeoutMS } : {}),
      ...(connectTimeoutMS !== undefined ? { connectTimeoutMS } : {}),
      ...(autoIndex != undefined ? { autoIndex } : {}),
      ...(autoCreate != undefined ? { autoCreate } : {}),
      // useNewUrlParser: true,
      // useUnifiedTopology: true,
      // bufferMaxEntries: 0,
      // useFindAndModify: true,
      // useCreateIndex: true
    };
    logger.info('Mongo Connection options');
    logger.info(JSON.stringify(opts, null, 2));
    const uriDriverParams = getUriDriverParams(MONGO_URI);
    if (Object.keys(uriDriverParams).length > 0) {
      logger.info(`MONGO_URI driver params: ${JSON.stringify(uriDriverParams)}`);
    }
    mongoose.set('strictQuery', true);
    cached.promise = mongoose.connect(MONGO_URI, opts).then((mongooseInstance) => {
      logResolvedDriverOptions(mongooseInstance);
      return mongooseInstance;
    });
  }
  cached.conn = await cached.promise;

  return cached.conn;
}

module.exports = {
  connectDb,
};
