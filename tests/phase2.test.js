/**
 * Phase 2 + Phase 3 Validation Test Suite
 * Run: node tests/phase2.test.js
 */
require("dotenv").config();

const bcrypt   = require("bcryptjs");
const jwt      = require("jsonwebtoken");
const QRCode   = require("qrcode");
const UAParser = require("ua-parser-js");
const geoip    = require("geoip-lite");
const crypto   = require("crypto");

const G = (s) => `\x1b[32m${s}\x1b[0m`;
const R = (s) => `\x1b[31m${s}\x1b[0m`;
const B = (s) => `\x1b[34m${s}\x1b[0m`;

let passed = 0, failed = 0;

function test(label, fn) {
  try { fn(); console.log(`  ${G("✓")} ${label}`); passed++; }
  catch (e) { console.log(`  ${R("✗")} ${label}\n      ${R(e.message)}`); failed++; }
}
async function testAsync(label, fn) {
  try { await fn(); console.log(`  ${G("✓")} ${label}`); passed++; }
  catch (e) { console.log(`  ${R("✗")} ${label}\n      ${R(e.message)}`); failed++; }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || "Assertion failed"); }

(async () => {

// ─────────────────────────────────────────────────────────────────────────────
console.log(`\n${B("━━━ 1. Environment & Config ━━━")}`);
test("JWT_SECRET loaded",  () => assert(process.env.JWT_SECRET?.length >= 10));
test("MONGO_URI loaded",   () => assert(!!process.env.MONGO_URI));
test("PORT loaded",        () => assert(!!process.env.PORT));

// ─────────────────────────────────────────────────────────────────────────────
console.log(`\n${B("━━━ 2. bcrypt Password Hashing ━━━")}`);
await testAsync("hash produces $2 prefix",         async () => { const h = await bcrypt.hash("pw", 10); assert(h.startsWith("$2")); });
await testAsync("compare → true for correct pw",   async () => { const h = await bcrypt.hash("pw", 10); assert(await bcrypt.compare("pw", h)); });
await testAsync("compare → false for wrong pw",    async () => { const h = await bcrypt.hash("pw", 10); assert(!(await bcrypt.compare("bad", h))); });
test("hash !== plain text",                        () => assert(bcrypt.hashSync("x", 10) !== "x"));

// ─────────────────────────────────────────────────────────────────────────────
console.log(`\n${B("━━━ 3. JWT Auth Service ━━━")}`);
const { setUser, getUser } = require("../service/auth");
test("setUser returns JWT string",             () => { const t = setUser({ _id: "1", name: "A", email: "a@b.com" }); assert(typeof t === "string" && t.length > 20); });
test("getUser decodes name correctly",         () => { const t = setUser({ _id: "1", name: "Alice", email: "a@b.com" }); assert(getUser(t).name === "Alice"); });
test("getUser decodes email correctly",        () => { const t = setUser({ _id: "1", name: "A", email: "x@y.com" }); assert(getUser(t).email === "x@y.com"); });
test("getUser → null for tampered token",      () => assert(getUser(setUser({ _id: "1", name: "A" }) + "x") === null));
test("getUser → null for undefined",           () => assert(getUser(undefined) === null));
test("getUser → null for empty string",        () => assert(getUser("") === null));
test("getUser → null for expired token",       () => { const t = jwt.sign({ _id: "x" }, process.env.JWT_SECRET, { expiresIn: "-1s" }); assert(getUser(t) === null); });

// ─────────────────────────────────────────────────────────────────────────────
console.log(`\n${B("━━━ 4. Custom Alias Validation ━━━")}`);
function isValidAlias(a) { return /^[a-zA-Z0-9_-]{3,30}$/.test(a); }
test("valid: simple word",           () => assert(isValidAlias("hello")));
test("valid: hyphen+underscore",     () => assert(isValidAlias("my-brand_v2")));
test("valid: 3 chars (min)",         () => assert(isValidAlias("abc")));
test("valid: 30 chars (max)",        () => assert(isValidAlias("a".repeat(30))));
test("invalid: 2 chars",             () => assert(!isValidAlias("ab")));
test("invalid: 31 chars",            () => assert(!isValidAlias("a".repeat(31))));
test("invalid: space",               () => assert(!isValidAlias("my brand")));
test("invalid: special chars",       () => assert(!isValidAlias("my@brand!")));
test("invalid: empty string",        () => assert(!isValidAlias("")));
test("invalid: slash",               () => assert(!isValidAlias("my/url")));

// ─────────────────────────────────────────────────────────────────────────────
console.log(`\n${B("━━━ 5. Link Expiry Logic ━━━")}`);
const isExpiredLink = (e) => e && e < new Date();
const isFutureDate  = (s) => { const d = new Date(s); return !isNaN(d.getTime()) && d > new Date(); };
test("null = never expires",          () => assert(!isExpiredLink(null)));
test("future date = not expired",     () => assert(!isExpiredLink(new Date(Date.now() + 86400000))));
test("past date = expired",           () => assert(isExpiredLink(new Date(Date.now() - 86400000))));
test("tomorrow is valid expiry",      () => { const d = new Date(); d.setDate(d.getDate()+1); assert(isFutureDate(d.toISOString())); });
test("yesterday is invalid expiry",   () => { const d = new Date(); d.setDate(d.getDate()-1); assert(!isFutureDate(d.toISOString())); });
test("garbage string rejected",       () => assert(!isFutureDate("not-a-date")));

// ─────────────────────────────────────────────────────────────────────────────
console.log(`\n${B("━━━ 6. QR Code Generation ━━━")}`);
await testAsync("generates base64 data URL",        async () => { const d = await QRCode.toDataURL("https://ex.com"); assert(d.startsWith("data:image/png;base64,")); });
await testAsync("base64 payload is non-trivial",    async () => { const d = await QRCode.toDataURL("https://ex.com"); assert(d.length > 500); });
await testAsync("dark-theme colours work",          async () => { const d = await QRCode.toDataURL("https://ex.com", { color: { dark: "#e8e8f0", light: "#18181f" } }); assert(d.startsWith("data:image/png;base64,")); });

// ─────────────────────────────────────────────────────────────────────────────
console.log(`\n${B("━━━ 7. URL Model Schema ━━━")}`);
const URL_Model = require("../models/url");
const paths = URL_Model.schema.paths;
test("shortId field exists",        () => assert("shortId" in paths));
test("redirectId field exists",     () => assert("redirectId" in paths));
test("visitHistory field exists",   () => assert("visitHistory" in paths));
test("expiresAt field (Phase 2)",   () => assert("expiresAt" in paths));
test("isActive field (Phase 2)",    () => assert("isActive" in paths));
test("isActive defaults to true",   () => assert(paths.isActive.defaultValue === true));

// Phase 3 — enriched visitHistory sub-fields
const vPaths = URL_Model.schema.path("visitHistory").schema?.paths || {};
test("visitHistory.ip (Phase 3)",       () => assert("ip"       in vPaths, "ip missing from visitHistory"));
test("visitHistory.country (Phase 3)",  () => assert("country"  in vPaths, "country missing"));
test("visitHistory.city (Phase 3)",     () => assert("city"     in vPaths, "city missing"));
test("visitHistory.browser (Phase 3)",  () => assert("browser"  in vPaths, "browser missing"));
test("visitHistory.os (Phase 3)",       () => assert("os"       in vPaths, "os missing"));
test("visitHistory.device (Phase 3)",   () => assert("device"   in vPaths, "device missing"));
test("visitHistory.referrer (Phase 3)", () => assert("referrer" in vPaths, "referrer missing"));

// ─────────────────────────────────────────────────────────────────────────────
console.log(`\n${B("━━━ 8. Route Ordering ━━━")}`);
const urlRouter = require("../routes/url");
const routes = urlRouter.stack.filter(l => l.route).map(l => ({ path: l.route.path, method: Object.keys(l.route.methods)[0] }));
const idx = (p, m) => routes.findIndex(r => r.path === p && r.method === m);
test("Router has routes",                           () => assert(routes.length > 0));
test("analytics before /:id wildcard",              () => { const a = idx("/analytics/:id","get"), w = idx("/:id","get"); assert(a !== -1 && w !== -1 && a < w, `analytics(${a}) must be before wildcard(${w})`); });
test("delete/:id route registered",                 () => assert(routes.some(r => r.path === "/delete/:id")));
test("toggle/:id route registered",                 () => assert(routes.some(r => r.path === "/toggle/:id")));
test("POST / (create) registered",                  () => assert(idx("/", "post") !== -1));

// ─────────────────────────────────────────────────────────────────────────────
console.log(`\n${B("━━━ 9. Rate Limiters ━━━")}`);
const { loginLimiter, signupLimiter, urlShortenLimiter } = require("../middlewares/rateLimiter");
test("loginLimiter is middleware",      () => assert(typeof loginLimiter === "function"));
test("signupLimiter is middleware",     () => assert(typeof signupLimiter === "function"));
test("urlShortenLimiter is middleware", () => assert(typeof urlShortenLimiter === "function"));

// ─────────────────────────────────────────────────────────────────────────────
console.log(`\n${B("━━━ 10. 7-day Chart Bucketing ━━━")}`);
function buildChart(history) {
  const now = new Date();
  const days = Array.from({ length: 7 }, (_, i) => { const d = new Date(now); d.setDate(d.getDate()-(6-i)); return d.toLocaleDateString("en-US",{month:"short",day:"numeric"}); });
  const counts = new Array(7).fill(0);
  history.forEach(({ timestamps }) => { const ago = Math.floor((now - new Date(timestamps))/86400000); if (ago < 7) counts[6-ago]++; });
  return { days, counts };
}
test("7 day labels produced",           () => assert(buildChart([]).days.length === 7));
test("empty → all zeros",               () => assert(buildChart([]).counts.every(c => c === 0)));
test("today visit → bucket[6]",         () => assert(buildChart([{ timestamps: Date.now() }]).counts[6] === 1));
test("8-day-old visit not counted",     () => assert(buildChart([{ timestamps: Date.now() - 8*86400000 }]).counts.every(c => c === 0)));
test("3 today + 1 yesterday",           () => { const r = buildChart([{ timestamps: Date.now() }, { timestamps: Date.now() }, { timestamps: Date.now() }, { timestamps: Date.now()-86400000 }]); assert(r.counts[6]===3 && r.counts[5]===1); });

// ─────────────────────────────────────────────────────────────────────────────
console.log(`\n${B("━━━ 11. Phase 3 — UA Parser ━━━")}`);
const chromeUA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const iosUA    = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const botUA    = "Googlebot/2.1 (+http://www.google.com/bot.html)";
test("Chrome/Windows detected",        () => { const r = new UAParser(chromeUA).getResult(); assert(r.browser.name === "Chrome", `got ${r.browser.name}`); assert(r.os.name === "Windows", `got ${r.os.name}`); });
test("iPhone/Safari detected",         () => { const r = new UAParser(iosUA).getResult(); assert(r.browser.name === "Mobile Safari" || r.browser.name === "Safari", `got ${r.browser.name}`); assert(r.device.type === "mobile", `got ${r.device.type}`); });
test("desktop has no device.type",     () => { const r = new UAParser(chromeUA).getResult(); assert(!r.device.type, `expected undefined, got ${r.device.type}`); });
test("UA parser handles undefined UA", () => { const r = new UAParser(undefined).getResult(); assert(r !== null); });

// ─────────────────────────────────────────────────────────────────────────────
console.log(`\n${B("━━━ 12. Phase 3 — Device Classification ━━━")}`);
function classifyDevice(ua) {
  const type = ua.device?.type;
  if (!type) return "Desktop";
  if (type === "mobile") return "Mobile";
  if (type === "tablet") return "Tablet";
  return "Other";
}
test("desktop → 'Desktop'",  () => assert(classifyDevice(new UAParser(chromeUA).getResult()) === "Desktop"));
test("mobile  → 'Mobile'",   () => assert(classifyDevice(new UAParser(iosUA).getResult()) === "Mobile"));
test("unknown → 'Desktop'",  () => assert(classifyDevice({}) === "Desktop"));

// ─────────────────────────────────────────────────────────────────────────────
console.log(`\n${B("━━━ 13. Phase 3 — IP Hashing (Privacy) ━━━")}`);
function hashIp(ip) { return crypto.createHash("sha256").update(ip || "").digest("hex").slice(0, 16); }
test("IP hashed to 16-char hex",          () => { const h = hashIp("1.2.3.4"); assert(h.length === 16 && /^[0-9a-f]+$/.test(h)); });
test("same IP → same hash",               () => assert(hashIp("1.2.3.4") === hashIp("1.2.3.4")));
test("different IPs → different hashes",  () => assert(hashIp("1.2.3.4") !== hashIp("5.6.7.8")));
test("hash does NOT contain original IP", () => assert(!hashIp("192.168.1.1").includes("192.168")));

// ─────────────────────────────────────────────────────────────────────────────
console.log(`\n${B("━━━ 14. Phase 3 — Aggregate Helper ━━━")}`);
function aggregate(arr, limit = 5) {
  const c = {};
  arr.forEach(v => { const k = v || "Unknown"; c[k] = (c[k]||0)+1; });
  return Object.entries(c).sort((a,b)=>b[1]-a[1]).slice(0,limit).map(([label,count])=>({label,count}));
}
test("most frequent item is first",        () => { const r = aggregate(["A","B","A","A","B"]); assert(r[0].label === "A" && r[0].count === 3); });
test("respects limit param",               () => assert(aggregate(["A","B","C","D","E","F"], 3).length === 3));
test("null/undefined → 'Unknown'",         () => assert(aggregate([null, undefined, null])[0].label === "Unknown"));
test("empty array → empty result",         () => assert(aggregate([]).length === 0));

// ─────────────────────────────────────────────────────────────────────────────
console.log(`\n${B("━━━ 15. Phase 3 — Country Flag Emoji ━━━")}`);
function countryFlag(code) {
  if (!code || code.length !== 2) return "🌐";
  return String.fromCodePoint(...code.toUpperCase().split("").map(c => 0x1F1E6 + c.charCodeAt(0) - 65));
}
test("IN → 🇮🇳",        () => assert(countryFlag("IN") === "🇮🇳", `got ${countryFlag("IN")}`));
test("US → 🇺🇸",        () => assert(countryFlag("US") === "🇺🇸", `got ${countryFlag("US")}`));
test("GB → 🇬🇧",        () => assert(countryFlag("GB") === "🇬🇧", `got ${countryFlag("GB")}`));
test("null → 🌐",       () => assert(countryFlag(null) === "🌐"));
test("empty → 🌐",      () => assert(countryFlag("") === "🌐"));
test("too long → 🌐",   () => assert(countryFlag("USA") === "🌐"));

// ─────────────────────────────────────────────────────────────────────────────
console.log(`\n${B("━━━ 16. Phase 3 — Unique Click Deduplication ━━━")}`);
function uniqueClicks(history) { return new Set(history.map(v => v.ip)).size; }
test("0 visits → 0 unique",                       () => assert(uniqueClicks([]) === 0));
test("3 same IP → 1 unique",                      () => assert(uniqueClicks([{ip:"aaa"},{ip:"aaa"},{ip:"aaa"}]) === 1));
test("3 different IPs → 3 unique",                () => assert(uniqueClicks([{ip:"a"},{ip:"b"},{ip:"c"}]) === 3));
test("2 same + 1 diff → 2 unique",                () => assert(uniqueClicks([{ip:"a"},{ip:"a"},{ip:"b"}]) === 2));

// ─────────────────────────────────────────────────────────────────────────────
const total = passed + failed;
console.log(`\n${"─".repeat(55)}`);
if (failed === 0) {
  console.log(G(`✅  All ${total} tests passed!`));
} else {
  console.log(`${G(`✓ ${passed} passed`)}  ${R(`✗ ${failed} failed`)}  / ${total} total`);
}
console.log(`${"─".repeat(55)}\n`);
if (failed > 0) process.exit(1);

})();
