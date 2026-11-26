const { Queue, Worker } = require("bullmq");
const URL = require("../models/url");
const logger = require("./logger");
const { isRedisReady } = require("./cache");

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
const QUEUE_NAME = "snipurl-click-logs";

let clickQueue = null;
let clickWorker = null;

function parseRedisConnection(urlStr) {
  try {
    const u = new global.URL(urlStr);
    return {
      host: u.hostname || "127.0.0.1",
      port: Number(u.port) || 6379,
      username: u.username || undefined,
      password: u.password || undefined,
      tls: u.protocol === "rediss:" ? {} : undefined,
      maxRetriesPerRequest: null,
    };
  } catch {
    return { host: "127.0.0.1", port: 6379, maxRetriesPerRequest: null };
  }
}

/**
 * Initializes the BullMQ Queue and Worker for async click logging.
 * No-ops gracefully if DISABLE_REDIS=true.
 */
function initClickQueue() {
  if (process.env.DISABLE_REDIS === "true") return null;
  if (clickQueue) return { queue: clickQueue, worker: clickWorker };

  const connection = parseRedisConnection(REDIS_URL);

  clickQueue = new Queue(QUEUE_NAME, {
    connection,
    defaultJobOptions: {
      removeOnComplete: 500,
      removeOnFail: 100,
      attempts: 3,
      backoff: { type: "exponential", delay: 500 },
    },
  });

  clickWorker = new Worker(
    QUEUE_NAME,
    async (job) => {
      const { shortId, visit } = job.data;
      await URL.updateOne({ shortId }, { $push: { visitHistory: visit } });
    },
    { connection, concurrency: 10 }
  );

  clickWorker.on("failed", (job, err) => {
    logger.error({ jobId: job?.id, err: err?.message }, "Click log job failed");
  });

  return { queue: clickQueue, worker: clickWorker };
}

/**
 * Enqueues a click telemetry event to BullMQ/Redis for async persistence.
 * Falls back to direct MongoDB updateOne if Redis/Queue is unavailable.
 * Returns { queued: boolean }.
 */
async function enqueueClickLog(shortId, visit) {
  if (
    process.env.DISABLE_REDIS !== "true" &&
    process.env.DISABLE_CLICK_QUEUE !== "true" &&
    isRedisReady()
  ) {
    try {
      const q = initClickQueue()?.queue;
      if (q) {
        await q.add("log-click", { shortId, visit });
        return { queued: true };
      }
    } catch (err) {
      logger.warn({ err: err.message }, "BullMQ enqueue failed, falling back to direct DB write");
    }
  }

  await URL.updateOne({ shortId }, { $push: { visitHistory: visit } });
  return { queued: false };
}

async function closeClickQueue() {
  if (clickWorker) {
    await clickWorker.close().catch(() => {});
    clickWorker = null;
  }
  if (clickQueue) {
    await clickQueue.close().catch(() => {});
    clickQueue = null;
  }
}

module.exports = {
  initClickQueue,
  enqueueClickLog,
  closeClickQueue,
  QUEUE_NAME,
};
