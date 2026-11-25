const URL      = require("../models/url");
const shortid  = require("shortid");
const QRCode   = require("qrcode");
const UAParser = require("ua-parser-js");
const geoip    = require("geoip-lite");
const crypto   = require("crypto");

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isValidAlias(alias) {
  return /^[a-zA-Z0-9_-]{3,30}$/.test(alias);
}

/** Validate that the target URL uses http: or https: */
function isValidHttpUrl(raw) {
  try {
    const parsed = new global.URL(raw);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function buildShortUrl(req, shortId) {
  return `${req.protocol}://${req.get("host")}/url/${shortId}`;
}

/** One-way hash the IP for privacy (GDPR-safe) */
function hashIp(ip) {
  return crypto.createHash("sha256").update(ip || "").digest("hex").slice(0, 16);
}

/** Extract real IP behind proxies/load balancers */
function getClientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (forwarded) return forwarded.split(",")[0].trim();
  return req.socket?.remoteAddress || req.ip || "127.0.0.1";
}

/** Classify device type from ua-parser result */
function classifyDevice(ua) {
  const type = ua.device?.type;
  if (!type) return "Desktop";
  if (type === "mobile") return "Mobile";
  if (type === "tablet") return "Tablet";
  return "Other";
}

/** Aggregate an array of values into { label, count } sorted by count desc */
function aggregate(arr, limit = 5) {
  const counts = {};
  arr.forEach((v) => { const k = v || "Unknown"; counts[k] = (counts[k] || 0) + 1; });
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([label, count]) => ({ label, count }));
}

/** Country code → flag emoji */
function countryFlag(code) {
  if (!code || code.length !== 2) return "🌐";
  return String.fromCodePoint(
    ...code.toUpperCase().split("").map((c) => 0x1f1e6 + c.charCodeAt(0) - 65)
  );
}

// ─── Create short URL ─────────────────────────────────────────────────────────

async function handleGenerateNewShortURL(req, res) {
  const { id: originalUrl, customAlias, expiresAt } = req.body;

  const renderWithError = async (error) => {
    const urls = await URL.find({ createdBy: req.user._id }).sort({ createdAt: -1 });
    return res.render("home", { urls, name: req.user.name, error });
  };

  if (!originalUrl) return renderWithError("Please provide a URL to shorten.");
  if (!isValidHttpUrl(originalUrl)) return renderWithError("Please enter a valid http:// or https:// URL.");

  // Custom alias
  let shortId;
  if (customAlias && customAlias.trim()) {
    const alias = customAlias.trim();
    if (!isValidAlias(alias)) return renderWithError("Custom alias must be 3–30 characters (letters, numbers, - or _).");
    if (await URL.findOne({ shortId: alias })) return renderWithError(`The alias "${alias}" is already taken.`);
    shortId = alias;
  } else {
    shortId = shortid();
  }

  // Expiry
  let expiry = null;
  if (expiresAt && expiresAt.trim()) {
    expiry = new Date(expiresAt);
    if (isNaN(expiry.getTime()) || expiry <= new Date()) return renderWithError("Expiry date must be a valid future date.");
  }

  await URL.create({ shortId, redirectId: originalUrl, visitHistory: [], createdBy: req.user._id, expiresAt: expiry });

  const urls = await URL.find({ createdBy: req.user._id }).sort({ createdAt: -1 });
  return res.render("home", { urls, name: req.user.name, newShortId: shortId, newShortUrl: buildShortUrl(req, shortId) });
}

// ─── Redirect + collect analytics ────────────────────────────────────────────

async function handleRedirectToURL(req, res) {
  const shortId = req.params.id;
  if (!shortId) return res.status(404).render("error", { message: "Page not found." });

  const result = await URL.findOne({ shortId });

  if (!result || !result.isActive) {
    return res.status(404).render("error", { message: "This short link does not exist or has been disabled." });
  }

  if (result.expiresAt && result.expiresAt < new Date()) {
    return res.status(410).render("error", {
      message: `This link expired on ${result.expiresAt.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}.`,
    });
  }

  // ── Collect visitor data ──────────────────────────────────────────────────
  const ip        = getClientIp(req);
  const ipHash    = hashIp(ip);
  const geo       = geoip.lookup(ip) || {};
  const ua        = new UAParser(req.headers["user-agent"]).getResult();
  const referrer  = req.headers["referer"] || req.headers["referrer"] || "(direct)";
  const device    = classifyDevice(ua);

  const visit = {
    timestamps: Date.now(),
    ip:         ipHash,
    country:    geo.country || "Unknown",
    city:       geo.city    || "Unknown",
    browser:    ua.browser?.name || "Unknown",
    os:         ua.os?.name      || "Unknown",
    device,
    referrer:   referrer.length > 200 ? referrer.slice(0, 200) : referrer,
  };

  await URL.updateOne({ shortId }, { $push: { visitHistory: visit } });

  return res.redirect(result.redirectId);
}

// ─── Analytics ────────────────────────────────────────────────────────────────

async function handleAnayticsOfURL(req, res) {
  const shortId = req.params.id;
  if (!shortId) return res.status(404).render("error", { message: "Page not found." });

  const result = await URL.findOne({ shortId, createdBy: req.user._id });
  if (!result) return res.status(403).render("error", { message: "Forbidden: You do not own this link." });

  const shortUrl  = buildShortUrl(req, shortId);
  const history   = result.visitHistory;
  const totalClicks = history.length;

  // Unique clicks (by hashed IP)
  const uniqueClicks = new Set(history.map((v) => v.ip)).size;

  // QR Code
  const qrDataUrl = await QRCode.toDataURL(shortUrl, {
    width: 220, margin: 2,
    color: { dark: "#e8e8f0", light: "#18181f" },
  });

  // 7-day chart
  const now = new Date();
  const chartDays = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(now);
    d.setDate(d.getDate() - (6 - i));
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  });
  const chartCounts = new Array(7).fill(0);
  history.forEach(({ timestamps }) => {
    const daysAgo = Math.floor((now - new Date(timestamps)) / 86400000);
    if (daysAgo < 7) chartCounts[6 - daysAgo]++;
  });

  // ── Aggregations ──
  const topBrowsers  = aggregate(history.map((v) => v.browser));
  const topOS        = aggregate(history.map((v) => v.os));
  const topCountries = aggregate(history.map((v) => v.country)).map((e) => ({
    ...e, flag: countryFlag(e.label),
  }));
  const topReferrers = aggregate(history.map((v) => v.referrer));

  // Device breakdown (pie data)
  const deviceCounts = { Desktop: 0, Mobile: 0, Tablet: 0, Other: 0 };
  history.forEach(({ device }) => { deviceCounts[device] = (deviceCounts[device] || 0) + 1; });

  return res.render("analytics", {
    shortId: result.shortId,
    redirectId: result.redirectId,
    shortUrl,
    totalClicks,
    uniqueClicks,
    visitHistory: history,
    createdAt: new Date(result.createdAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }),
    expiresAt: result.expiresAt
      ? result.expiresAt.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })
      : null,
    isExpired: result.expiresAt ? result.expiresAt < now : false,
    isActive: result.isActive,
    qrDataUrl,
    chartDays:    JSON.stringify(chartDays),
    chartCounts:  JSON.stringify(chartCounts),
    topBrowsers:  JSON.stringify(topBrowsers),
    topOS:        JSON.stringify(topOS),
    topCountries: JSON.stringify(topCountries),
    topReferrers: JSON.stringify(topReferrers),
    deviceCounts: JSON.stringify(deviceCounts),
  });
}

// ─── Delete ───────────────────────────────────────────────────────────────────

async function handleDeleteURL(req, res) {
  const result = await URL.findOne({ shortId: req.params.id, createdBy: req.user._id });
  if (!result) return res.status(403).render("error", { message: "Forbidden: You do not own this link." });
  await URL.deleteOne({ shortId: req.params.id });
  return res.redirect("/?deleted=1");
}

// ─── Toggle ───────────────────────────────────────────────────────────────────

async function handleToggleURL(req, res) {
  const result = await URL.findOne({ shortId: req.params.id, createdBy: req.user._id });
  if (!result) return res.status(403).render("error", { message: "Forbidden: You do not own this link." });
  await URL.updateOne({ shortId: req.params.id }, { isActive: !result.isActive });
  // Redirect back to wherever the user came from (analytics or dashboard)
  const ref = req.headers.referer || "/";
  return res.redirect(ref);
}

module.exports = {
  handleGenerateNewShortURL,
  handleRedirectToURL,
  handleAnayticsOfURL,
  handleDeleteURL,
  handleToggleURL,
};
