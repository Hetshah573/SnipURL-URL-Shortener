/**
 * Phase 5 Validation & Integration Test Suite
 * Tests:
 *  - Docker files (Dockerfile, docker-compose.yml, .dockerignore)
 *  - Password-protected links (unlock prompt, 401 on wrong pw, 302 on correct pw)
 *  - Max-click expiry (410 Gone once click limit reached)
 *  - Link tags & UTM builder (appendUtmParams, parseTags, ?tag= filter)
 *  - Analytics date-range filter (?range=24h|7d|30d|all) & CSV export (formula-safe)
 *  - Swagger /api-docs & /health endpoint
 *
 * Run: node tests/phase5.test.js
 */
require("dotenv").config();
process.env.DISABLE_REDIS = "true";

const express = require("express");
const cookieParser = require("cookie-parser");
const swaggerUi = require("swagger-ui-express");
const fs = require("fs");
const path = require("path");
const http = require("http");
const { Duplex } = require("stream");
const assert = require("assert");

const URLModel = require("../models/url");
const UserModel = require("../models/user");
const swaggerSpec = require("../service/swagger");
const {
  appendUtmParams,
  parseTags,
  filterVisitsByRange,
  escapeCsvCell,
} = require("../controllers/url");

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
    maxClicks: null,
    passwordHash: null,
    tags: [],
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
app.get("/health", (req, res) => res.json({ ok: true, mongo: "mock", redis: "disabled" }));
app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));
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
  console.log(`\n${B("━━━ Phase 5: Docker & Health & Swagger ━━━")}`);

  await test("Dockerfile, docker-compose.yml, and .dockerignore exist", async () => {
    const root = path.resolve(__dirname, "..");
    assert(fs.existsSync(path.join(root, "Dockerfile")), "Dockerfile missing");
    assert(fs.existsSync(path.join(root, "docker-compose.yml")), "docker-compose.yml missing");
    assert(fs.existsSync(path.join(root, ".dockerignore")), ".dockerignore missing");
  });

  await test("GET /health returns 200 JSON", async () => {
    const res = await request("GET", "/health");
    assert.strictEqual(res.status, 200);
    assert.strictEqual(JSON.parse(res.body).ok, true);
  });

  await test("GET /api-docs/ serves Swagger UI HTML", async () => {
    const res = await request("GET", "/api-docs/");
    assert.strictEqual(res.status, 200);
    assert(res.body.includes("swagger-ui"), "Swagger UI should render");
  });

  console.log(`\n${B("━━━ Phase 5: UTM Builder, Tags, Range Filter & CSV Helpers ━━━")}`);

  await test("appendUtmParams appends utm_source, utm_medium, utm_campaign", async () => {
    const out = appendUtmParams("https://example.com/page?foo=1", {
      utmSource: "twitter",
      utmMedium: "social",
      utmCampaign: "launch",
    });
    assert(out.includes("foo=1"));
    assert(out.includes("utm_source=twitter"));
    assert(out.includes("utm_medium=social"));
    assert(out.includes("utm_campaign=launch"));
  });

  await test("parseTags normalizes, deduplicates, and cleans tags", async () => {
    const tags = parseTags("Marketing, youtube, marketing, Q4-Sale!");
    assert.deepStrictEqual(tags, ["marketing", "youtube", "q4-sale"]);
  });

  await test("filterVisitsByRange filters 24h vs 7d vs all", async () => {
    const now = Date.now();
    const visits = [
      { timestamps: now - 1000 },             // < 24h
      { timestamps: now - 3 * 86400000 },     // 3d ago
      { timestamps: now - 20 * 86400000 },    // 20d ago
    ];
    assert.strictEqual(filterVisitsByRange(visits, "24h").length, 1);
    assert.strictEqual(filterVisitsByRange(visits, "7d").length, 2);
    assert.strictEqual(filterVisitsByRange(visits, "30d").length, 3);
    assert.strictEqual(filterVisitsByRange(visits, "all").length, 3);
  });

  await test("escapeCsvCell neutralizes formula injection (=, +, -, @)", async () => {
    assert.strictEqual(escapeCsvCell("=CMD()"), "'=CMD()");
    assert.strictEqual(escapeCsvCell("+123"), "'+123");
    assert.strictEqual(escapeCsvCell('a,"b"'), '"a,""b"""');
  });

  console.log(`\n${B("━━━ Phase 5: Password-Protected Links, Max Clicks, Tags & CSV Export ━━━")}`);

  await request("POST", "/user", {
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: "name=P5User&email=p5@example.com&password=password123",
  });
  const loginRes = await request("POST", "/user/login", {
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: "email=p5@example.com&password=password123",
  });
  const rawCookies = Array.isArray(loginRes.headers["set-cookie"])
    ? loginRes.headers["set-cookie"]
    : [loginRes.headers["set-cookie"]];
  const authCookie = rawCookies.find((c) => c.startsWith("token=")).split(";")[0];

  await test("POST /url creates password-protected, max-click, tagged, UTM link", async () => {
    const res = await request("POST", "/url", {
      headers: { "content-type": "application/x-www-form-urlencoded", cookie: authCookie },
      body: "id=https://example.com&customAlias=vip-link&maxClicks=2&linkPassword=secret99&tags=vip,launch&utmSource=email",
    });
    assert.strictEqual(res.status, 302);
    assert.strictEqual(res.headers.location, "/?created=vip-link");
    const doc = urlsStore.find((u) => u.shortId === "vip-link");
    assert(doc.passwordHash, "passwordHash should be stored");
    assert.strictEqual(doc.maxClicks, 2);
    assert.deepStrictEqual(doc.tags, ["vip", "launch"]);
    assert(doc.redirectId.includes("utm_source=email"));
  });

  await test("GET /url/vip-link renders password prompt (unlock.ejs)", async () => {
    const res = await request("GET", "/url/vip-link");
    assert.strictEqual(res.status, 200);
    assert(res.body.includes("Password Required"), "Should show unlock page");
  });

  await test("POST /url/vip-link/unlock rejects wrong password (401) & allows right password (302)", async () => {
    const bad = await request("POST", "/url/vip-link/unlock", {
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "password=wrong",
    });
    assert.strictEqual(bad.status, 401);

    const ok1 = await request("POST", "/url/vip-link/unlock", {
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "password=secret99",
    });
    assert.strictEqual(ok1.status, 302);
    assert(ok1.headers.location.startsWith("https://example.com"));

    // 2nd click succeeds
    const ok2 = await request("POST", "/url/vip-link/unlock", {
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "password=secret99",
    });
    assert.strictEqual(ok2.status, 302);

    // 3rd click hits maxClicks=2 -> 410 Gone!
    const over = await request("GET", "/url/vip-link");
    assert.strictEqual(over.status, 410);
  });

  await test("GET /?tag=vip filters dashboard links by tag", async () => {
    const res = await request("GET", "/?tag=vip", { headers: { cookie: authCookie } });
    assert.strictEqual(res.status, 200);
    assert(res.body.includes("/vip-link"), "Should include vip-link");

    const miss = await request("GET", "/?tag=nonexistent", { headers: { cookie: authCookie } });
    assert.strictEqual(miss.status, 200);
    assert(!miss.body.includes("/vip-link"), "Should not include vip-link");
  });

  await test("GET /url/analytics/vip-link/export returns CSV attachment", async () => {
    const res = await request("GET", "/url/analytics/vip-link/export?range=all", {
      headers: { cookie: authCookie },
    });
    assert.strictEqual(res.status, 200);
    assert(res.headers["content-type"].includes("text/csv"));
    assert(res.headers["content-disposition"].includes("snipurl-vip-link-analytics.csv"));
    const lines = res.body.trim().split("\n");
    assert.strictEqual(lines.length, 3, "Header + 2 visit rows expected");
  });

  console.log(`\n${"─".repeat(55)}`);
  if (failed === 0) {
    console.log(G(`✅  All ${passed} Phase 5 tests passed!`));
  } else {
    console.log(`${G(`✓ ${passed} passed`)}  ${R(`✗ ${failed} failed`)}`);
    process.exit(1);
  }
  console.log(`${"─".repeat(55)}\n`);
})();
