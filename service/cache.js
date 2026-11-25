const Redis = require("ioredis");

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
const DEFAULT_TTL_SEC = 60 * 60; // 1 hour cache TTL

let client = null;
let connected = false;

/**
 * Lazily initializes and returns the Redis client.
 * Fails gracefully (returns null) if Redis is disabled or unreachable.
 */
function getRedisClient() {
  if (process.env.DISABLE_REDIS === "true") return null;
  if (client) return client;

  client = new Redis(REDIS_URL, {
    maxRetriesPerRequest: 1,
    connectTimeout: 2000,
    retryStrategy(times) {
      if (times > 3) return null; // stop retrying after 3 attempts
      return Math.min(times * 200, 1000);
    },
    lazyConnect: true,
  });

  client.on("ready", () => {
    connected = true;
  });
  client.on("close", () => {
    connected = false;
  });
  client.on("error", () => {
    connected = false;
  });

  // Connect in background without blocking startup
  client.connect().catch(() => {
    connected = false;
  });

  return client;
}

function isRedisReady() {
  return connected && client?.status === "ready";
}

function cacheKey(shortId) {
  return `snipurl:link:${shortId}`;
}

/**
 * Fetches cached redirect metadata for a shortId.
 * Returns null on cache miss or if Redis is unavailable.
 */
async function getCachedUrl(shortId) {
  const redis = getRedisClient();
  if (!redis || redis.status !== "ready") return null;
  try {
    const raw = await redis.get(cacheKey(shortId));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/**
 * Caches redirect metadata for a shortId with a TTL (capped by expiresAt if set).
 */
async function setCachedUrl(shortId, data, ttlSeconds = DEFAULT_TTL_SEC) {
  const redis = getRedisClient();
  if (!redis || redis.status !== "ready") return false;
  try {
    let ttl = ttlSeconds;
    if (data.expiresAt) {
      const secsLeft = Math.floor((new Date(data.expiresAt).getTime() - Date.now()) / 1000);
      if (secsLeft <= 0) return false;
      ttl = Math.min(ttl, secsLeft);
    }
    const payload = JSON.stringify({
      shortId: data.shortId,
      redirectId: data.redirectId,
      expiresAt: data.expiresAt || null,
      isActive: data.isActive !== false,
    });
    await redis.set(cacheKey(shortId), payload, "EX", ttl);
    return true;
  } catch {
    return false;
  }
}

/**
 * Invalidates the cached entry for a shortId (call on edit, pause/resume, or delete).
 */
async function delCachedUrl(shortId) {
  const redis = getRedisClient();
  if (!redis || redis.status !== "ready") return false;
  try {
    await redis.del(cacheKey(shortId));
    return true;
  } catch {
    return false;
  }
}

async function closeRedis() {
  if (client) {
    try {
      await client.quit();
    } catch {
      client.disconnect();
    }
    client = null;
    connected = false;
  }
}

module.exports = {
  getRedisClient,
  isRedisReady,
  getCachedUrl,
  setCachedUrl,
  delCachedUrl,
  closeRedis,
};
