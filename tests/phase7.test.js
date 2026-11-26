/**
 * Phase 7 Validation & Integration Test Suite
 * Tests:
 *  - BullMQ async click logging queue against live Docker Redis
 *  - Pino structured logging + X-Request-Id header
 *  - Zod schema validation (signup, login, createUrl, editUrl)
 *  - CSRF double-submit cookie protection (403 without token, passes with valid token, skips /api/v1)
 *
 * Run: node tests/phase7.test.js
 */
require("dotenv").config();
process.env.CLICK_QUEUE_NAME = "snipurl-click-logs-test";

const express = require("express");
const cookieParser = require("cookie-parser");
const path = require("path");
const http = require("http");
const { Duplex } = require("stream");
const assert = require("assert");

const URLModel = require("../models/url");
const UserModel = require("../models/user");
const { getRedisClient, closeRedis } = require("../service/cache");
const { initClickQueue, enqueueClickLog, closeClickQueue } = require("../service/clickQueue");
const requestLogger = require("../middlewares/requestLogger");
const { csrfProtection } = require("../middlewares/csrf");
const {
  signupSchema,
  loginSchema,
  createUrlSchema,
  editUrlSchema,
} = require("../validators/schemas");

// ── In-memory DB mocks ────────────────────────────────────────────────────────
const usersStore = [];
const urlsStore = [];

UserModel.findOne = async (query) => {
  return usersStore.find((u) => Object.entries(query).every(([k, v]) => u[k] === v)) || null;
};
UserModel.create = async (doc) => {
  const user = { _id: String(usersStore.length + 1), ...doc };
  usersStore.push(user);
  return user;
};

URLModel.find = (query) => {
  const filtered = urlsStore.filter((u) =>
    Object.entries(query).every(([k, v]) => String(u[k]) === String(v))
  );
  return {
    sort: async () => [...filtered].sort((a, b) => b.createdAt - a.createdAt),
  };
};
URLModel.findOne = async (query) => {
  return (
    urlsStore.find((u) =>
      Object.entries(query).every(([k, v]) => String(u[k]) === String(v))
    ) || null
  );
};
URLModel.create = async (doc) => {
  const item = {
    isActive: true,
    expiresAt: null,
    maxClicks: null,
    passwordHash: null,
    tags: [],
    webhookUrl: null,
    visitHistory: [],
    createdAt: new Date(),
    ...doc,
  };
  urlsStore.push(item);
  return item;
};
URLModel.updateOne = async (query, update) => {
  const item = urlsStore.find((u) =>
    Object.entries(query).every(([k, v]) => String(u[k]) === String(v))
  );
  if (!item) return { modifiedCount: 0 };
  if (update.$push?.visitHistory) item.visitHistory.push(update.$push.visitHistory);
  return { modifiedCount: 1 };
};

// ── Build Express app with requestLogger + csrfProtection ─────────────────────
const staticroute = require("../routes/staticroute");
const urlroute = require("../routes/url");
const userroute = require("../routes/user");
const apiroute = require("../routes/api");
const { checkAuth } = require("../middlewares/auth");

const app = express();
app.set("view engine", "ejs");
app.set("views", path.resolve(__dirname, "../views"));
app.use(requestLogger);
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(csrfProtection);
app.use("/api/v1", apiroute);
app.use("/url", urlroute);
app.use("/", checkAuth, staticroute);
app.use("/user", userroute);

function request(method, reqPath, { body = null, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const socket = new Duplex({ read() {}, write(c, e, cb) { cb(); } });
    socket.remoteAddress = "127.0.0.1";

    const req = new http.IncomingMessage(socket);
    req.method = method;
    req.url = reqPath;
    req.headers = { host: "localhost:5000", ...headers };
    if (body) req.headers["content-length"] = Buffer.byteLength(body);

    const res = new http.ServerResponse(req);
    const chunks = [];
    const origWrite = res.write.bind(res);
    const origEnd = res.end.bind(res);
    res.write = (c, e, cb) => {
      if (c) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c, e));
      return origWrite(c, e, cb);
    };
    res.end = (c, e, cb) => {
      if (c) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c, e));
      const out = origEnd(c, e, cb);
      const raw = Buffer.concat(chunks).toString("utf8");
      const sep = raw.indexOf("\r\n\r\n");
      const bodyText = raw.startsWith("HTTP/1.") && sep !== -1 ? raw.slice(sep + 4) : raw;
      resolve({ status: res.statusCode, headers: res.getHeaders(), body: bodyText });
      return out;
    };

    res.assignSocket(socket);
    app.handle(req, res, (err) => { if (err) reject(err); });
    if (body) req.push(body);
    req.push(null);
  });
}

const G = (s) => `\x1b[32m${s}\x1b[0m`;
const R = (s) => `\x1b[31m${s}\x1b[0m`;
const B = (s) => `\x1b[34m${s}\x1b[0m`;

let passed = 0;
let failed = 0;

async function test(label, fn) {
  try {
    await fn();
    console.log(`  ${G("✓")} ${label}`);
    passed++;
  } catch (err) {
    console.log(`  ${R("✗")} ${label}\n      ${R(err.message)}`);
    failed++;
  }
}

(async () => {
  // Connect Redis & initialize BullMQ worker
  const redis = getRedisClient();
  await new Promise((resolve) => {
    if (!redis || redis.status === "ready") return resolve();
    const timer = setTimeout(resolve, 2500);
    redis.once("ready", () => { clearTimeout(timer); resolve(); });
    redis.once("error", () => { clearTimeout(timer); resolve(); });
  });
  const qInfo = initClickQueue();
  if (qInfo?.worker) {
    await qInfo.worker.waitUntilReady().catch(() => {});
  }

  console.log(`\n${B("━━━ Phase 7: Zod Schema Validation ━━━")}`);

  await test("signupSchema rejects short password & invalid email", async () => {
    assert.strictEqual(signupSchema.safeParse({ name: "A", email: "bad", password: "123" }).success, false);
    assert.strictEqual(signupSchema.safeParse({ name: "Alice", email: "a@b.com", password: "password1" }).success, true);
  });

  await test("createUrlSchema validates URL, alias, and maxClicks", async () => {
    assert.strictEqual(createUrlSchema.safeParse({ url: "not-a-url" }).success, false);
    assert.strictEqual(createUrlSchema.safeParse({ url: "https://ex.com", customAlias: "x" }).success, false);
    assert.strictEqual(createUrlSchema.safeParse({ url: "https://ex.com", maxClicks: "0" }).success, false);
    assert.strictEqual(createUrlSchema.safeParse({ url: "https://ex.com", customAlias: "valid-1", maxClicks: "5" }).success, true);
  });

  await test("editUrlSchema rejects invalid redirectId", async () => {
    assert.strictEqual(editUrlSchema.safeParse({ redirectId: "ftp://bad" }).success, false);
    assert.strictEqual(editUrlSchema.safeParse({ redirectId: "https://good.com" }).success, true);
  });

  console.log(`\n${B("━━━ Phase 7: Structured Logging & Request IDs ━━━")}`);

  await test("Responses include X-Request-Id header", async () => {
    const res = await request("GET", "/login");
    assert.strictEqual(res.status, 200);
    assert(res.headers["x-request-id"], "X-Request-Id header should be present");
  });

  await test("Preserves incoming X-Request-Id header", async () => {
    const res = await request("GET", "/login", { headers: { "x-request-id": "trace-abc-123" } });
    assert.strictEqual(res.headers["x-request-id"], "trace-abc-123");
  });

  console.log(`\n${B("━━━ Phase 7: CSRF Protection ━━━")}`);

  await test("GET /signup sets csrf_token cookie and embeds _csrf hidden input", async () => {
    const res = await request("GET", "/signup");
    assert.strictEqual(res.status, 200);
    const setCookies = Array.isArray(res.headers["set-cookie"])
      ? res.headers["set-cookie"]
      : [res.headers["set-cookie"]];
    const csrfCookie = setCookies.find((c) => c.startsWith("csrf_token="));
    assert(csrfCookie, "csrf_token cookie missing");
    assert(res.body.includes('name="_csrf"'), "Hidden _csrf input missing in signup.ejs");
  });

  await test("POST /user without CSRF token returns 403", async () => {
    const res = await request("POST", "/user", {
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "name=Mallory&email=m@test.com&password=password123",
    });
    assert.strictEqual(res.status, 403);
    assert(res.body.includes("Invalid or missing CSRF token"));
  });

  await test("POST /user with valid double-submit CSRF token succeeds (302)", async () => {
    const getRes = await request("GET", "/signup");
    const setCookies = Array.isArray(getRes.headers["set-cookie"])
      ? getRes.headers["set-cookie"]
      : [getRes.headers["set-cookie"]];
    const csrfPair = setCookies.find((c) => c.startsWith("csrf_token=")).split(";")[0];
    const csrfVal = csrfPair.split("=")[1];

    const postRes = await request("POST", "/user", {
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        cookie: csrfPair,
      },
      body: `_csrf=${csrfVal}&name=ValidUser&email=valid@test.com&password=password123`,
    });
    assert.strictEqual(postRes.status, 302);
    assert.strictEqual(postRes.headers.location, "/login?registered=1");
  });

  await test("REST API (/api/v1/*) bypasses CSRF & uses API key auth (401 without key)", async () => {
    const res = await request("POST", "/api/v1/shorten", {
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "https://example.com" }),
    });
    assert.strictEqual(res.status, 401);
  });

  console.log(`\n${B("━━━ Phase 7: BullMQ Async Click Logging Queue ━━━")}`);

  await test("enqueueClickLog queues job in BullMQ/Redis & worker persists visit asynchronously", async () => {
    await URLModel.create({
      shortId: "bullmq-demo",
      redirectId: "https://bullmq.io",
      createdBy: "1",
    });

    const visit = {
      timestamps: Date.now(),
      ip: "1234567890abcdef",
      country: "US",
      city: "NYC",
      browser: "Chrome",
      os: "Windows",
      device: "Desktop",
      referrer: "(direct)",
      isBot: false,
    };

    const result = await enqueueClickLog("bullmq-demo", visit);
    if (redis && redis.status === "ready") {
      assert.strictEqual(result.queued, true, "Expected job to be queued via BullMQ");
      for (let i = 0; i < 60; i++) {
        const doc = urlsStore.find((u) => u.shortId === "bullmq-demo");
        if (doc && doc.visitHistory.length === 1) break;
        await new Promise((r) => setTimeout(r, 100));
      }
    } else {
      assert.strictEqual(result.queued, false, "Expected direct DB fallback when Redis is offline");
    }

    const updated = urlsStore.find((u) => u.shortId === "bullmq-demo");
    assert.strictEqual(updated.visitHistory.length, 1, "BullMQ worker should persist the click");
    assert.strictEqual(updated.visitHistory[0].browser, "Chrome");
  });

  await closeClickQueue();
  await closeRedis();

  console.log(`\n${"─".repeat(55)}`);
  if (failed === 0) {
    console.log(G(`✅  All ${passed} Phase 7 tests passed!`));
  } else {
    console.log(`${G(`✓ ${passed} passed`)}  ${R(`✗ ${failed} failed`)}`);
    process.exit(1);
  }
  console.log(`${"─".repeat(55)}\n`);
})();
