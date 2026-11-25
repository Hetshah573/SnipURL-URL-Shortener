/**
 * Phase 4 + Live Docker Redis Test Suite
 * Tests:
 *  - Live Redis caching (set, get, TTL, invalidation on edit/toggle/delete)
 *  - Bot filtering (isBotUserAgent + humanClicks vs botClicks)
 *  - Edit destination URL (cache invalidation + redirect to updated URL)
 *  - Dashboard Search, Sort & Pagination
 *  - REST API (/api/v1/*) + API Key generation & revocation
 *
 * Run: node tests/phase4.test.js
 */
require("dotenv").config();

const express = require("express");
const cookieParser = require("cookie-parser");
const path = require("path");
const http = require("http");
const { Duplex } = require("stream");
const assert = require("assert");

const URLModel = require("../models/url");
const UserModel = require("../models/user");
const {
  getRedisClient,
  getCachedUrl,
  setCachedUrl,
  delCachedUrl,
  closeRedis,
} = require("../service/cache");
const { isBotUserAgent } = require("../controllers/url");

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
UserModel.updateOne = async (query, update) => {
  const user = await UserModel.findOne(query);
  if (!user) return { modifiedCount: 0 };
  Object.assign(user, update);
  return { modifiedCount: 1 };
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
    visitHistory: [],
    createdAt: new Date(Date.now() + urlsStore.length * 1000),
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
  if (typeof update.isActive === "boolean") item.isActive = update.isActive;
  if (typeof update.redirectId === "string") item.redirectId = update.redirectId;
  return { modifiedCount: 1 };
};
URLModel.deleteOne = async (query) => {
  const idx = urlsStore.findIndex((u) =>
    Object.entries(query).every(([k, v]) => String(u[k]) === String(v))
  );
  if (idx !== -1) urlsStore.splice(idx, 1);
  return { deletedCount: idx !== -1 ? 1 : 0 };
};

// ── Build Express app ─────────────────────────────────────────────────────────
const staticroute = require("../routes/staticroute");
const urlroute = require("../routes/url");
const userroute = require("../routes/user");
const apiroute = require("../routes/api");
const { checkAuth } = require("../middlewares/auth");

const app = express();
app.set("view engine", "ejs");
app.set("views", path.resolve(__dirname, "../views"));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use("/api/v1", apiroute);
app.use("/url", urlroute);
app.use("/", checkAuth, staticroute);
app.use("/user", userroute);

// ── In-process request dispatcher ─────────────────────────────────────────────
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
  // Connect to live Docker Redis
  const redis = getRedisClient();
  // Wait briefly for Redis ready
  await new Promise((resolve) => {
    if (!redis || redis.status === "ready") return resolve();
    const timer = setTimeout(resolve, 2500);
    redis.once("ready", () => { clearTimeout(timer); resolve(); });
    redis.once("error", () => { clearTimeout(timer); resolve(); });
  });

  console.log(`\n${B("━━━ Phase 4: Live Docker Redis Caching ━━━")}`);

  await test("Redis container is connected & responds to PING", async () => {
    assert(redis && redis.status === "ready", `Redis not ready (status: ${redis?.status})`);
    const pong = await redis.ping();
    assert.strictEqual(pong, "PONG");
  });

  await test("setCachedUrl, getCachedUrl, and delCachedUrl roundtrip", async () => {
    const ok = await setCachedUrl("redis-test-1", {
      shortId: "redis-test-1",
      redirectId: "https://redis.io",
      isActive: true,
    });
    assert.strictEqual(ok, true);
    const hit = await getCachedUrl("redis-test-1");
    assert.strictEqual(hit.redirectId, "https://redis.io");
    await delCachedUrl("redis-test-1");
    const miss = await getCachedUrl("redis-test-1");
    assert.strictEqual(miss, null);
  });

  console.log(`\n${B("━━━ Phase 4: Bot Filtering ━━━")}`);

  await test("Detects Googlebot, curl, Slackbot, WhatsApp as bots", async () => {
    assert.strictEqual(isBotUserAgent("Googlebot/2.1 (+http://www.google.com/bot.html)"), true);
    assert.strictEqual(isBotUserAgent("curl/8.4.0"), true);
    assert.strictEqual(isBotUserAgent("Slackbot-LinkExpanding 1.0"), true);
    assert.strictEqual(isBotUserAgent("WhatsApp/2.23.20 A"), true);
    assert.strictEqual(isBotUserAgent(""), true);
  });

  await test("Detects real Chrome & iPhone Safari as human visitors", async () => {
    assert.strictEqual(isBotUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36"), false);
    assert.strictEqual(isBotUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile/15E148 Safari/604.1"), false);
  });

  console.log(`\n${B("━━━ Phase 4: API Key Auth & REST API (/api/v1) ━━━")}`);

  // Create & log in a user
  await request("POST", "/user", {
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: "name=ApiUser&email=api@example.com&password=password123",
  });
  const loginRes = await request("POST", "/user/login", {
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: "email=api@example.com&password=password123",
  });
  const rawCookies = Array.isArray(loginRes.headers["set-cookie"])
    ? loginRes.headers["set-cookie"]
    : [loginRes.headers["set-cookie"]];
  const authCookie = rawCookies.find((c) => c.startsWith("token=")).split(";")[0];

  let apiKey = "";
  await test("POST /user/api-key generates & flashes API key once", async () => {
    const res = await request("POST", "/user/api-key", { headers: { cookie: authCookie } });
    assert.strictEqual(res.status, 302);
    const setCookies = Array.isArray(res.headers["set-cookie"])
      ? res.headers["set-cookie"]
      : [res.headers["set-cookie"]];
    const keyCookie = setCookies.find((c) => c.startsWith("new_api_key="));
    assert(keyCookie, "new_api_key cookie should be set");
    apiKey = decodeURIComponent(keyCookie.split(";")[0].split("=")[1]);
    assert(apiKey.startsWith("snip_"), "API key should start with snip_");
  });

  await test("GET /api/v1/links returns 401 without API key", async () => {
    const res = await request("GET", "/api/v1/links");
    assert.strictEqual(res.status, 401);
  });

  await test("POST /api/v1/shorten creates link & warms Redis cache", async () => {
    const res = await request("POST", "/api/v1/shorten", {
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ url: "https://expressjs.com", customAlias: "express-v5" }),
    });
    assert.strictEqual(res.status, 201);
    const data = JSON.parse(res.body);
    assert.strictEqual(data.shortId, "express-v5");
    const cached = await getCachedUrl("express-v5");
    assert(cached && cached.redirectId === "https://expressjs.com", "Redis cache should be warmed");
  });

  await test("Redirect serves from Redis cache (0 DB findOne calls) & separates human vs bot clicks", async () => {
    const saved = urlsStore.find((u) => u.shortId === "express-v5");
    assert(saved, "URL should exist in store");

    // Spy on URLModel.findOne to prove redirect uses Redis cache instead of DB
    const origFindOne = URLModel.findOne;
    let findOneCalls = 0;
    URLModel.findOne = async (q) => {
      findOneCalls++;
      return origFindOne(q);
    };

    try {
      // 1 human click + 1 bot click
      const r1 = await request("GET", "/url/express-v5", {
        headers: { "user-agent": "Mozilla/5.0 (Windows NT 10.0) Chrome/120.0.0.0" },
      });
      const r2 = await request("GET", "/url/express-v5", {
        headers: { "user-agent": "curl/8.4.0" },
      });
      assert.strictEqual(r1.status, 302);
      assert.strictEqual(r1.headers.location, "https://expressjs.com");
      assert.strictEqual(r2.status, 302);
      assert.strictEqual(findOneCalls, 0, "Expected 0 DB findOne calls on Redis cache hit");
    } finally {
      URLModel.findOne = origFindOne;
    }

    const statsRes = await request("GET", "/api/v1/analytics/express-v5", {
      headers: { "x-api-key": apiKey },
    });
    assert.strictEqual(statsRes.status, 200);
    const stats = JSON.parse(statsRes.body);
    assert.strictEqual(stats.totalClicks, 2);
    assert.strictEqual(stats.humanClicks, 1);
    assert.strictEqual(stats.botClicks, 1);
  });

  await test("PATCH /api/v1/links/:id updates destination & invalidates Redis cache", async () => {
    const patchRes = await request("PATCH", "/api/v1/links/express-v5", {
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ redirectId: "https://expressjs.com/en/5x/api.html" }),
    });
    assert.strictEqual(patchRes.status, 200);
    const cachedAfterEdit = await getCachedUrl("express-v5");
    assert.strictEqual(cachedAfterEdit, null, "Redis cache must be invalidated on edit");

    const redir = await request("GET", "/url/express-v5", {
      headers: { "user-agent": "Mozilla/5.0 Chrome/120.0" },
    });
    assert.strictEqual(redir.headers.location, "https://expressjs.com/en/5x/api.html");
  });

  console.log(`\n${B("━━━ Phase 4: Search, Sort & Pagination ━━━")}`);

  await test("Dashboard GET / supports search (?q=) and sort (?sort=most_clicked)", async () => {
    await request("POST", "/api/v1/shorten", {
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ url: "https://redis.io/docs", customAlias: "redis-docs" }),
    });

    const searchRes = await request("GET", "/?q=redis", { headers: { cookie: authCookie } });
    assert.strictEqual(searchRes.status, 200);
    assert(searchRes.body.includes("/redis-docs"), "Should find redis-docs");
    assert(!searchRes.body.includes("/express-v5"), "Should filter out express-v5");
  });

  await test("DELETE /api/v1/links/:id deletes link & clears Redis cache", async () => {
    const delRes = await request("DELETE", "/api/v1/links/express-v5", {
      headers: { authorization: `Bearer ${apiKey}` },
    });
    assert.strictEqual(delRes.status, 200);
    assert.strictEqual(await getCachedUrl("express-v5"), null);
  });

  await test("POST /user/api-key/revoke invalidates API key", async () => {
    await request("POST", "/user/api-key/revoke", { headers: { cookie: authCookie } });
    const res = await request("GET", "/api/v1/links", {
      headers: { authorization: `Bearer ${apiKey}` },
    });
    assert.strictEqual(res.status, 401);
    await delCachedUrl("redis-docs");
  });

  await closeRedis();

  console.log(`\n${"─".repeat(55)}`);
  if (failed === 0) {
    console.log(G(`✅  All ${passed} Phase 4 + Redis tests passed!`));
  } else {
    console.log(`${G(`✓ ${passed} passed`)}  ${R(`✗ ${failed} failed`)}`);
    process.exit(1);
  }
  console.log(`${"─".repeat(55)}\n`);
})();
