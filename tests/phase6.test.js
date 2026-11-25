/**
 * Phase 6 Validation & Integration Test Suite
 * Tests:
 *  - Self-redirect loop guard (blocks shortening own host)
 *  - Blocked metadata host guard (169.254.169.254, metadata.google.internal)
 *  - Google Safe Browsing API integration (mocked fetch when API key is set)
 *  - Click webhooks (fires async POST JSON event with X-SnipURL-Event header)
 *
 * Run: node tests/phase6.test.js
 */
require("dotenv").config();
process.env.DISABLE_REDIS = "true";

const express = require("express");
const cookieParser = require("cookie-parser");
const path = require("path");
const http = require("http");
const { Duplex } = require("stream");
const assert = require("assert");

const URLModel = require("../models/url");
const UserModel = require("../models/user");
const {
  isSelfRedirect,
  isBlockedHost,
  validateTargetUrlSafety,
} = require("../service/urlSafety");

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
  if ("webhookUrl" in update) item.webhookUrl = update.webhookUrl;
  return { modifiedCount: 1 };
};

// ── Build Express app ─────────────────────────────────────────────────────────
const staticroute = require("../routes/staticroute");
const urlroute = require("../routes/url");
const userroute = require("../routes/user");
const { checkAuth } = require("../middlewares/auth");

const app = express();
app.set("view engine", "ejs");
app.set("views", path.resolve(__dirname, "../views"));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
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
  console.log(`\n${B("━━━ Phase 6: Self-Redirect & Malicious URL Guard ━━━")}`);

  await test("isSelfRedirect detects matching host", async () => {
    assert.strictEqual(isSelfRedirect("http://localhost:5000/url/abc", "localhost:5000"), true);
    assert.strictEqual(isSelfRedirect("https://example.com/page", "localhost:5000"), false);
  });

  await test("isBlockedHost blocks cloud metadata IPs", async () => {
    assert.strictEqual(isBlockedHost("http://169.254.169.254/latest/meta-data"), true);
    assert.strictEqual(isBlockedHost("http://metadata.google.internal/computeMetadata"), true);
    assert.strictEqual(isBlockedHost("https://google.com"), false);
  });

  await test("Google Safe Browsing rejects flagged malware URLs when API key is configured", async () => {
    const origFetch = global.fetch;
    process.env.GOOGLE_SAFE_BROWSING_API_KEY = "test-key";
    global.fetch = async () => ({
      ok: true,
      json: async () => ({ matches: [{ threatType: "MALWARE" }] }),
    });

    try {
      const res = await validateTargetUrlSafety("https://evil-malware.test", "localhost:5000");
      assert.strictEqual(res.ok, false);
      assert(res.error.includes("MALWARE"));
    } finally {
      delete process.env.GOOGLE_SAFE_BROWSING_API_KEY;
      global.fetch = origFetch;
    }
  });

  // Auth setup for route tests
  await request("POST", "/user", {
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: "name=P6User&email=p6@example.com&password=password123",
  });
  const loginRes = await request("POST", "/user/login", {
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: "email=p6@example.com&password=password123",
  });
  const rawCookies = Array.isArray(loginRes.headers["set-cookie"])
    ? loginRes.headers["set-cookie"]
    : [loginRes.headers["set-cookie"]];
  const authCookie = rawCookies.find((c) => c.startsWith("token=")).split(";")[0];

  await test("POST /url blocks self-redirect URL (localhost:5000)", async () => {
    const res = await request("POST", "/url", {
      headers: { "content-type": "application/x-www-form-urlencoded", cookie: authCookie },
      body: "id=http://localhost:5000/url/anything",
    });
    assert.strictEqual(res.status, 200);
    assert(res.body.includes("Self-redirect detected"));
    assert.strictEqual(urlsStore.length, 0);
  });

  await test("POST /url blocks self-referencing webhookUrl", async () => {
    const res = await request("POST", "/url", {
      headers: { "content-type": "application/x-www-form-urlencoded", cookie: authCookie },
      body: "id=https://example.org&webhookUrl=http://localhost:5000/hook",
    });
    assert.strictEqual(res.status, 200);
    assert(res.body.includes("Webhook URL must be a valid external"));
    assert.strictEqual(urlsStore.length, 0);
  });

  console.log(`\n${B("━━━ Phase 6: Click Webhooks ━━━")}`);

  await test("Redirect fires non-blocking POST JSON webhook with click telemetry", async () => {
    const createRes = await request("POST", "/url", {
      headers: { "content-type": "application/x-www-form-urlencoded", cookie: authCookie },
      body: "id=https://example.org/docs&customAlias=hook-demo&webhookUrl=https://hooks.example.com/events",
    });
    assert.strictEqual(createRes.status, 302);

    const captured = [];
    const origFetch = global.fetch;
    global.fetch = async (url, opts) => {
      captured.push({ url, opts });
      return { ok: true };
    };

    try {
      const redir = await request("GET", "/url/hook-demo", {
        headers: { "user-agent": "Mozilla/5.0 (Windows NT 10.0) Chrome/120.0.0.0" },
      });
      assert.strictEqual(redir.status, 302);
      assert.strictEqual(redir.headers.location, "https://example.org/docs");

      // Let async fetch microtask settle
      await new Promise((r) => setTimeout(r, 20));
      assert.strictEqual(captured.length, 1, "Webhook should have been called once");
      assert.strictEqual(captured[0].url, "https://hooks.example.com/events");
      assert.strictEqual(captured[0].opts.method, "POST");
      assert.strictEqual(captured[0].opts.headers["X-SnipURL-Event"], "link.clicked");

      const payload = JSON.parse(captured[0].opts.body);
      assert.strictEqual(payload.event, "link.clicked");
      assert.strictEqual(payload.shortId, "hook-demo");
      assert.strictEqual(payload.click.browser, "Chrome");
    } finally {
      global.fetch = origFetch;
    }
  });

  console.log(`\n${"─".repeat(55)}`);
  if (failed === 0) {
    console.log(G(`✅  All ${passed} Phase 6 tests passed!`));
  } else {
    console.log(`${G(`✓ ${passed} passed`)}  ${R(`✗ ${failed} failed`)}`);
    process.exit(1);
  }
  console.log(`${"─".repeat(55)}\n`);
})();
