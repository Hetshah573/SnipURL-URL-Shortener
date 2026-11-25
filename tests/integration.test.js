/**
 * Phase 2 + Phase 3 HTTP Integration Test Suite
 * Tests real Express routes, controllers, middlewares, JWT cookies, and EJS views
 * using an in-memory store mocked onto the Mongoose models (no DB or TCP port needed).
 * Run: node tests/integration.test.js
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
    visitHistory: [],
    createdAt: new Date(),
    ...doc,
  };
  urlsStore.push(item);
  return item;
};
URLModel.updateOne = async (query, update) => {
  const item = await URLModel.findOne(query);
  if (!item) return { modifiedCount: 0 };
  if (update.$push?.visitHistory) {
    item.visitHistory.push(update.$push.visitHistory);
  }
  if (typeof update.isActive === "boolean") {
    item.isActive = update.isActive;
  }
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

// ── In-process Express request dispatcher (no TCP port binding) ───────────────
function request(method, reqPath, { body = null, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const socket = new Duplex({
      read() {},
      write(chunk, enc, cb) {
        cb();
      },
    });
    socket.remoteAddress = "127.0.0.1";

    const req = new http.IncomingMessage(socket);
    req.method = method;
    req.url = reqPath;
    req.headers = { host: "localhost:5000", ...headers };
    if (body) {
      req.headers["content-length"] = Buffer.byteLength(body);
    }

    const res = new http.ServerResponse(req);
    const chunks = [];
    const origWrite = res.write.bind(res);
    const origEnd = res.end.bind(res);

    res.write = (chunk, encoding, cb) => {
      if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding));
      return origWrite(chunk, encoding, cb);
    };
    res.end = (chunk, encoding, cb) => {
      if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding));
      const result = origEnd(chunk, encoding, cb);
      const rawBody = Buffer.concat(chunks).toString("utf8");
      // Strip raw HTTP header block if ServerResponse prepended it
      const sepIdx = rawBody.indexOf("\r\n\r\n");
      const bodyText =
        rawBody.startsWith("HTTP/1.") && sepIdx !== -1 ? rawBody.slice(sepIdx + 4) : rawBody;
      resolve({
        status: res.statusCode,
        headers: res.getHeaders(),
        body: bodyText,
      });
      return result;
    };

    res.assignSocket(socket);
    app.handle(req, res, (err) => {
      if (err) reject(err);
    });

    if (body) req.push(body);
    req.push(null);
  });
}

// ── Test runner ───────────────────────────────────────────────────────────────
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
  console.log(`\n${B("━━━ Integration: Auth & Public/Protected Routes ━━━")}`);

  await test("Unauthenticated GET / redirects to /login", async () => {
    const res = await request("GET", "/");
    assert.strictEqual(res.status, 302);
    assert.strictEqual(res.headers.location, "/login");
  });

  await test("GET /signup and GET /Signup render signup page without redirect loop", async () => {
    const res1 = await request("GET", "/signup");
    assert.strictEqual(res1.status, 200);
    assert(res1.body.includes("Create your account"), "signup page should render");

    const res2 = await request("GET", "/Signup");
    assert.strictEqual(res2.status, 200);
    assert(res2.body.includes("Create your account"), "/Signup should also render without redirect loop");
  });

  await test("Unauthenticated POST /url redirects to /login", async () => {
    const res = await request("POST", "/url", {
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "id=https://example.com",
    });
    assert.strictEqual(res.status, 302);
    assert.strictEqual(res.headers.location, "/login");
  });

  await test("POST /user creates user with hashed password & redirects", async () => {
    const res = await request("POST", "/user", {
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "name=TestUser&email=test@example.com&password=password123",
    });
    assert.strictEqual(res.status, 302);
    assert.strictEqual(res.headers.location, "/login?registered=1");
    assert.strictEqual(usersStore.length, 1);
    assert.notStrictEqual(usersStore[0].password, "password123");
  });

  let authCookie = "";
  await test("POST /user/login sets httpOnly JWT cookie", async () => {
    const res = await request("POST", "/user/login", {
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "email=test@example.com&password=password123",
    });
    assert.strictEqual(res.status, 302);
    assert.strictEqual(res.headers.location, "/");
    const rawCookies = res.headers["set-cookie"] || [];
    const cookies = Array.isArray(rawCookies) ? rawCookies : [rawCookies];
    const tokenCookie = cookies.find((c) => c.startsWith("token="));
    assert(tokenCookie, "token cookie missing");
    assert(tokenCookie.toLowerCase().includes("httponly"), "cookie should be HttpOnly");
    authCookie = tokenCookie.split(";")[0];
  });

  console.log(`\n${B("━━━ Integration: Phase 2 (Custom Alias, Expiry, Toggle, Delete) ━━━")}`);

  await test("POST /url rejects javascript: URL", async () => {
    const res = await request("POST", "/url", {
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        cookie: authCookie,
      },
      body: "id=javascript:alert(1)",
    });
    assert.strictEqual(res.status, 200);
    assert(res.body.includes("valid http:// or https://"), "Should reject javascript: URL");
  });

  await test("POST /url creates short link with custom alias & future expiry (PRG redirect)", async () => {
    const future = new Date(Date.now() + 7 * 86400000).toISOString().split("T")[0];
    const res = await request("POST", "/url", {
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        cookie: authCookie,
      },
      body: `id=https://nodejs.org&customAlias=node-docs&expiresAt=${future}`,
    });
    assert.strictEqual(res.status, 302);
    assert.strictEqual(res.headers.location, "/?created=node-docs");
    assert.strictEqual(urlsStore.length, 1);
    assert.strictEqual(urlsStore[0].shortId, "node-docs");

    const homeRes = await request("GET", "/?created=node-docs", {
      headers: { cookie: authCookie },
    });
    assert.strictEqual(homeRes.status, 200);
    assert(homeRes.body.includes("/url/node-docs"), "Rendered page should contain new short URL");
    assert.strictEqual(urlsStore.length, 1, "Reloading should not create duplicate URL");
  });

  await test("POST /url rejects duplicate original URL for the same user", async () => {
    const res = await request("POST", "/url", {
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        cookie: authCookie,
      },
      body: "id=https://nodejs.org",
    });
    assert.strictEqual(res.status, 200);
    assert(res.body.includes("already shortened this URL"), "Should alert user that URL exists before");
    assert.strictEqual(urlsStore.length, 1);
  });

  await test("POST /url rejects duplicate custom alias", async () => {
    const res = await request("POST", "/url", {
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        cookie: authCookie,
      },
      body: "id=https://example.com&customAlias=node-docs",
    });
    assert.strictEqual(res.status, 200);
    assert(res.body.includes("already taken"), "Should warn about duplicate alias");
  });

  console.log(`\n${B("━━━ Integration: Phase 3 (Public Redirect + Analytics) ━━━")}`);

  await test("Public GET /url/node-docs redirects WITHOUT login & records UA/IP/referrer", async () => {
    const res = await request("GET", "/url/node-docs", {
      headers: {
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36",
        referer: "https://google.com/",
      },
    });
    assert.strictEqual(res.status, 302);
    assert.strictEqual(res.headers.location, "https://nodejs.org");
    assert.strictEqual(urlsStore[0].visitHistory.length, 1);
    const visit = urlsStore[0].visitHistory[0];
    assert.strictEqual(visit.browser, "Chrome");
    assert.strictEqual(visit.os, "Windows");
    assert.strictEqual(visit.device, "Desktop");
    assert.strictEqual(visit.referrer, "https://google.com/");
    assert(visit.ip && visit.ip.length === 16, "IP should be hashed");
  });

  await test("GET /url/analytics/node-docs renders QR, charts, and visitor stats", async () => {
    const res = await request("GET", "/url/analytics/node-docs", {
      headers: { cookie: authCookie },
    });
    assert.strictEqual(res.status, 200);
    assert(res.body.includes("data:image/png;base64,"), "QR code missing");
    assert(res.body.includes("Chrome"), "Browser breakdown missing");
    assert(res.body.includes("Windows"), "OS breakdown missing");
    assert(res.body.includes("https://google.com/"), "Referrer missing");
  });

  await test("POST /url/toggle/node-docs pauses link; paused link returns 404", async () => {
    const toggleRes = await request("POST", "/url/toggle/node-docs", {
      headers: { cookie: authCookie },
    });
    assert.strictEqual(toggleRes.status, 302);
    assert.strictEqual(urlsStore[0].isActive, false);

    const visitRes = await request("GET", "/url/node-docs");
    assert.strictEqual(visitRes.status, 404);
  });

  await test("Expired link returns 410 Gone", async () => {
    urlsStore[0].isActive = true;
    urlsStore[0].expiresAt = new Date(Date.now() - 86400000);
    const res = await request("GET", "/url/node-docs");
    assert.strictEqual(res.status, 410);
  });

  await test("POST /url/delete/node-docs deletes link", async () => {
    const res = await request("POST", "/url/delete/node-docs", {
      headers: { cookie: authCookie },
    });
    assert.strictEqual(res.status, 302);
    assert.strictEqual(res.headers.location, "/?deleted=1");
    assert.strictEqual(urlsStore.length, 0);
  });

  console.log(`\n${"─".repeat(55)}`);
  if (failed === 0) {
    console.log(G(`✅  All ${passed} integration tests passed!`));
  } else {
    console.log(`${G(`✓ ${passed} passed`)}  ${R(`✗ ${failed} failed`)}`);
    process.exit(1);
  }
  console.log(`${"─".repeat(55)}\n`);
})();
