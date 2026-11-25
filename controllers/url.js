const URL      = require("../models/url");
const shortid  = require("shortid");
const QRCode   = require("qrcode");
const UAParser = require("ua-parser-js");
const geoip    = require("geoip-lite");
const crypto   = require("crypto");
const bcrypt   = require("bcryptjs");
const { getCachedUrl, setCachedUrl, delCachedUrl } = require("../service/cache");
const { fireClickWebhook } = require("../service/webhook");
const { validateTargetUrlSafety, isSelfRedirect, isBlockedHost } = require("../service/urlSafety");

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

/** Appends optional UTM parameters to a valid http/https URL. */
function appendUtmParams(rawUrl, { utmSource, utmMedium, utmCampaign } = {}) {
  const hasUtm =
    (utmSource && utmSource.trim()) ||
    (utmMedium && utmMedium.trim()) ||
    (utmCampaign && utmCampaign.trim());
  if (!hasUtm) return rawUrl;
  const parsed = new global.URL(rawUrl);
  if (utmSource && utmSource.trim()) parsed.searchParams.set("utm_source", utmSource.trim());
  if (utmMedium && utmMedium.trim()) parsed.searchParams.set("utm_medium", utmMedium.trim());
  if (utmCampaign && utmCampaign.trim()) parsed.searchParams.set("utm_campaign", utmCampaign.trim());
  return parsed.toString();
}

/** Normalizes comma-separated or array tags into unique lowercase slugs. */
function parseTags(rawTags) {
  if (!rawTags) return [];
  const list = Array.isArray(rawTags) ? rawTags : String(rawTags).split(",");
  const cleaned = list
    .map((t) => String(t).trim().toLowerCase().replace(/[^a-z0-9_-]/g, ""))
    .filter(Boolean);
  return [...new Set(cleaned)].slice(0, 10);
}

/** Filters visitHistory by ?range=24h|7d|30d|all */
function filterVisitsByRange(history, range = "all") {
  const now = Date.now();
  const windows = { "24h": 86400000, "7d": 7 * 86400000, "30d": 30 * 86400000 };
  const ms = windows[range];
  if (!ms) return history;
  return history.filter((v) => now - v.timestamps <= ms);
}

/** Escapes a CSV cell and neutralizes formula injection (=, +, -, @). */
function escapeCsvCell(val) {
  let str = String(val ?? "");
  if (/^[=+\-@]/.test(str)) str = `'${str}`;
  if (/[",\n\r]/.test(str)) str = `"${str.replace(/"/g, '""')}"`;
  return str;
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

/** Detect bots, crawlers, and preview fetchers from User-Agent */
const BOT_REGEX = /bot|crawler|spider|slurp|curl|wget|python-requests|python-urllib|node-fetch|axios|postman|insomnia|facebookexternalhit|whatsapp|slackbot|discordbot|twitterbot|linkedinbot|telegrambot|applebot|bingpreview|headlesschrome|phantomjs/i;

function isBotUserAgent(uaString) {
  if (!uaString) return true;
  return BOT_REGEX.test(uaString);
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

/** Builds a visit telemetry record from an Express request. */
function buildVisitRecord(req) {
  const uaString = req.headers["user-agent"] || "";
  const isBot    = isBotUserAgent(uaString);
  const ip       = getClientIp(req);
  const ipHash   = hashIp(ip);
  const geo      = geoip.lookup(ip) || {};
  const ua       = new UAParser(uaString).getResult();
  const referrer = req.headers["referer"] || req.headers["referrer"] || "(direct)";
  const device   = classifyDevice(ua);

  return {
    timestamps: Date.now(),
    ip:         ipHash,
    country:    geo.country || "Unknown",
    city:       geo.city    || "Unknown",
    browser:    ua.browser?.name || "Unknown",
    os:         ua.os?.name      || "Unknown",
    device,
    referrer:   referrer.length > 200 ? referrer.slice(0, 200) : referrer,
    isBot,
  };
}

// ─── Create short URL ─────────────────────────────────────────────────────────

async function handleGenerateNewShortURL(req, res) {
  const {
    id: rawOriginalUrl,
    customAlias,
    expiresAt,
    maxClicks,
    linkPassword,
    tags,
    utmSource,
    utmMedium,
    utmCampaign,
    webhookUrl,
  } = req.body;

  const renderWithError = async (error) => {
    const urls = await URL.find({ createdBy: req.user._id }).sort({ createdAt: -1 });
    return res.render("home", { urls, name: req.user.name, error });
  };

  if (!rawOriginalUrl) return renderWithError("Please provide a URL to shorten.");
  if (!isValidHttpUrl(rawOriginalUrl)) return renderWithError("Please enter a valid http:// or https:// URL.");

  const finalUrl = appendUtmParams(rawOriginalUrl, { utmSource, utmMedium, utmCampaign });

  // Self-redirect loop & malicious URL guard
  const safety = await validateTargetUrlSafety(finalUrl, req.get("host"));
  if (!safety.ok) return renderWithError(safety.error);

  // Optional webhook URL validation
  let cleanWebhookUrl = null;
  if (webhookUrl && webhookUrl.trim()) {
    const wh = webhookUrl.trim();
    if (!isValidHttpUrl(wh) || isSelfRedirect(wh, req.get("host")) || isBlockedHost(wh)) {
      return renderWithError("Webhook URL must be a valid external http:// or https:// URL.");
    }
    cleanWebhookUrl = wh;
  }

  // Check if this user already shortened this exact URL
  const existingOriginal = await URL.findOne({ redirectId: finalUrl, createdBy: req.user._id });
  if (existingOriginal) {
    return renderWithError(`You already shortened this URL before (/${existingOriginal.shortId}).`);
  }

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

  // Expiry date
  let expiry = null;
  if (expiresAt && expiresAt.trim()) {
    expiry = new Date(expiresAt);
    if (isNaN(expiry.getTime()) || expiry <= new Date()) return renderWithError("Expiry date must be a valid future date.");
  }

  // Max-click limit
  let parsedMaxClicks = null;
  if (maxClicks && String(maxClicks).trim()) {
    const n = parseInt(maxClicks, 10);
    if (isNaN(n) || n < 1) return renderWithError("Max clicks must be a positive number.");
    parsedMaxClicks = n;
  }

  // Optional password protection
  let passwordHash = null;
  if (linkPassword && linkPassword.trim()) {
    passwordHash = await bcrypt.hash(linkPassword.trim(), 10);
  }

  const parsedTags = parseTags(tags);

  const created = await URL.create({
    shortId,
    redirectId: finalUrl,
    visitHistory: [],
    createdBy: req.user._id,
    expiresAt: expiry,
    maxClicks: parsedMaxClicks,
    passwordHash,
    tags: parsedTags,
    webhookUrl: cleanWebhookUrl,
  });

  await setCachedUrl(shortId, created);

  return res.redirect(`/?created=${encodeURIComponent(shortId)}`);
}

// ─── Redirect + Redis cache + Password & Max-Click checks ─────────────────────

async function handleRedirectToURL(req, res) {
  const shortId = req.params.id;
  if (!shortId) return res.status(404).render("error", { message: "Page not found." });

  let linkData = await getCachedUrl(shortId);
  let dbDoc = null;

  if (!linkData) {
    dbDoc = await URL.findOne({ shortId });
    if (!dbDoc) {
      return res.status(404).render("error", { message: "This short link does not exist or has been disabled." });
    }
    linkData = {
      shortId: dbDoc.shortId,
      redirectId: dbDoc.redirectId,
      expiresAt: dbDoc.expiresAt,
      isActive: dbDoc.isActive,
      hasPassword: Boolean(dbDoc.passwordHash),
      maxClicks: dbDoc.maxClicks || null,
      webhookUrl: dbDoc.webhookUrl || null,
    };
    await setCachedUrl(shortId, linkData);
  }

  if (!linkData.isActive) {
    return res.status(404).render("error", { message: "This short link does not exist or has been disabled." });
  }

  const expiryDate = linkData.expiresAt ? new Date(linkData.expiresAt) : null;
  if (expiryDate && expiryDate < new Date()) {
    return res.status(410).render("error", {
      message: `This link expired on ${expiryDate.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}.`,
    });
  }

  // Enforce max-click limit
  if (linkData.maxClicks) {
    const doc = dbDoc || (await URL.findOne({ shortId }));
    if (!doc || doc.visitHistory.length >= linkData.maxClicks) {
      return res.status(410).render("error", {
        message: `This link has reached its maximum limit of ${linkData.maxClicks} clicks.`,
      });
    }
  }

  // If password-protected, show unlock prompt before redirecting
  if (linkData.hasPassword) {
    return res.render("unlock", { shortId, error: null });
  }

  const visit = buildVisitRecord(req);
  await URL.updateOne({ shortId }, { $push: { visitHistory: visit } });

  if (linkData.webhookUrl) {
    fireClickWebhook(linkData.webhookUrl, {
      shortId,
      redirectId: linkData.redirectId,
      click: visit,
    }).catch(() => {});
  }

  return res.redirect(linkData.redirectId);
}

// ─── Unlock Password-Protected Link ───────────────────────────────────────────

async function handleUnlockURL(req, res) {
  const shortId = req.params.id;
  const { password } = req.body;

  const doc = await URL.findOne({ shortId });
  if (!doc || !doc.isActive) {
    return res.status(404).render("error", { message: "This short link does not exist or has been disabled." });
  }

  if (doc.expiresAt && new Date(doc.expiresAt) < new Date()) {
    return res.status(410).render("error", { message: "This link has expired." });
  }

  if (doc.maxClicks && doc.visitHistory.length >= doc.maxClicks) {
    return res.status(410).render("error", {
      message: `This link has reached its maximum limit of ${doc.maxClicks} clicks.`,
    });
  }

  if (doc.passwordHash) {
    const ok = password ? await bcrypt.compare(password, doc.passwordHash) : false;
    if (!ok) {
      return res.status(401).render("unlock", { shortId, error: "Incorrect password. Please try again." });
    }
  }

  const visit = buildVisitRecord(req);
  await URL.updateOne({ shortId }, { $push: { visitHistory: visit } });

  if (doc.webhookUrl) {
    fireClickWebhook(doc.webhookUrl, {
      shortId,
      redirectId: doc.redirectId,
      click: visit,
    }).catch(() => {});
  }

  return res.redirect(doc.redirectId);
}

// ─── Analytics (with Date-Range Filter) ───────────────────────────────────────

async function handleAnayticsOfURL(req, res) {
  const shortId = req.params.id;
  if (!shortId) return res.status(404).render("error", { message: "Page not found." });

  const result = await URL.findOne({ shortId, createdBy: req.user._id });
  if (!result) return res.status(403).render("error", { message: "Forbidden: You do not own this link." });

  const range = ["24h", "7d", "30d", "all"].includes(req.query.range) ? req.query.range : "all";
  const shortUrl    = buildShortUrl(req, shortId);
  const history     = filterVisitsByRange(result.visitHistory, range);
  const humanVisits = history.filter((v) => !v.isBot);
  const botClicks   = history.length - humanVisits.length;
  const totalClicks = history.length;

  const uniqueClicks = new Set(humanVisits.map((v) => v.ip)).size;

  const qrDataUrl = await QRCode.toDataURL(shortUrl, {
    width: 220, margin: 2,
    color: { dark: "#e8e8f0", light: "#18181f" },
  });

  // Chart buckets (7d or 30d)
  const now = new Date();
  const bucketCount = range === "30d" ? 30 : 7;
  const chartDays = Array.from({ length: bucketCount }, (_, i) => {
    const d = new Date(now);
    d.setDate(d.getDate() - (bucketCount - 1 - i));
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  });
  const chartCounts = new Array(bucketCount).fill(0);
  humanVisits.forEach(({ timestamps }) => {
    const daysAgo = Math.floor((now - new Date(timestamps)) / 86400000);
    if (daysAgo >= 0 && daysAgo < bucketCount) chartCounts[bucketCount - 1 - daysAgo]++;
  });

  const topBrowsers  = aggregate(humanVisits.map((v) => v.browser));
  const topOS        = aggregate(humanVisits.map((v) => v.os));
  const topCountries = aggregate(humanVisits.map((v) => v.country)).map((e) => ({
    ...e, flag: countryFlag(e.label),
  }));
  const topReferrers = aggregate(humanVisits.map((v) => v.referrer));

  const deviceCounts = { Desktop: 0, Mobile: 0, Tablet: 0, Other: 0 };
  humanVisits.forEach(({ device }) => { deviceCounts[device] = (deviceCounts[device] || 0) + 1; });

  return res.render("analytics", {
    shortId: result.shortId,
    redirectId: result.redirectId,
    shortUrl,
    totalClicks,
    allTimeClicks: result.visitHistory.length,
    humanClicks: humanVisits.length,
    botClicks,
    uniqueClicks,
    visitHistory: history,
    createdAt: new Date(result.createdAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }),
    expiresAt: result.expiresAt
      ? result.expiresAt.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })
      : null,
    isExpired: result.expiresAt ? result.expiresAt < now : false,
    isActive: result.isActive,
    hasPassword: Boolean(result.passwordHash),
    maxClicks: result.maxClicks || null,
    tags: result.tags || [],
    webhookUrl: result.webhookUrl || "",
    range,
    qrDataUrl,
    chartDays:    JSON.stringify(chartDays),
    chartCounts:  JSON.stringify(chartCounts),
    topBrowsers:  JSON.stringify(topBrowsers),
    topOS:        JSON.stringify(topOS),
    topCountries: JSON.stringify(topCountries),
    topReferrers: JSON.stringify(topReferrers),
    deviceCounts: JSON.stringify(deviceCounts),
    updated: req.query.updated === "1",
  });
}

// ─── Export Analytics CSV ─────────────────────────────────────────────────────

async function handleExportAnalyticsCSV(req, res) {
  const shortId = req.params.id;
  const result = await URL.findOne({ shortId, createdBy: req.user._id });
  if (!result) return res.status(403).render("error", { message: "Forbidden: You do not own this link." });

  const range = ["24h", "7d", "30d", "all"].includes(req.query.range) ? req.query.range : "all";
  const history = filterVisitsByRange(result.visitHistory, range);

  const header = "Timestamp,ISO_Date,Country,City,Browser,OS,Device,Referrer,Is_Bot";
  const rows = history.map((v) =>
    [
      v.timestamps,
      new Date(v.timestamps).toISOString(),
      v.country || "Unknown",
      v.city || "Unknown",
      v.browser || "Unknown",
      v.os || "Unknown",
      v.device || "Desktop",
      v.referrer || "(direct)",
      v.isBot ? "true" : "false",
    ]
      .map(escapeCsvCell)
      .join(",")
  );

  const csv = [header, ...rows].join("\n");
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="snipurl-${shortId}-analytics.csv"`);
  return res.send(csv);
}

// ─── Edit Destination URL ─────────────────────────────────────────────────────

async function handleEditURL(req, res) {
  const shortId = req.params.id;
  const { redirectId, webhookUrl } = req.body;

  if (!redirectId || !isValidHttpUrl(redirectId)) {
    return res.status(400).render("error", { message: "Please provide a valid http:// or https:// destination URL." });
  }

  const safety = await validateTargetUrlSafety(redirectId, req.get("host"));
  if (!safety.ok) {
    return res.status(400).render("error", { message: safety.error });
  }

  let cleanWebhookUrl = null;
  if (webhookUrl && webhookUrl.trim()) {
    const wh = webhookUrl.trim();
    if (!isValidHttpUrl(wh) || isSelfRedirect(wh, req.get("host")) || isBlockedHost(wh)) {
      return res.status(400).render("error", { message: "Webhook URL must be a valid external http:// or https:// URL." });
    }
    cleanWebhookUrl = wh;
  }

  const result = await URL.findOne({ shortId, createdBy: req.user._id });
  if (!result) return res.status(403).render("error", { message: "Forbidden: You do not own this link." });

  const updateFields = { redirectId };
  if (webhookUrl !== undefined) updateFields.webhookUrl = cleanWebhookUrl;

  await URL.updateOne({ shortId }, updateFields);
  await delCachedUrl(shortId);

  return res.redirect(`/url/analytics/${encodeURIComponent(shortId)}?updated=1`);
}

// ─── Delete ───────────────────────────────────────────────────────────────────

async function handleDeleteURL(req, res) {
  const result = await URL.findOne({ shortId: req.params.id, createdBy: req.user._id });
  if (!result) return res.status(403).render("error", { message: "Forbidden: You do not own this link." });
  await URL.deleteOne({ shortId: req.params.id });
  await delCachedUrl(req.params.id);
  return res.redirect("/?deleted=1");
}

// ─── Toggle ───────────────────────────────────────────────────────────────────

async function handleToggleURL(req, res) {
  const result = await URL.findOne({ shortId: req.params.id, createdBy: req.user._id });
  if (!result) return res.status(403).render("error", { message: "Forbidden: You do not own this link." });
  await URL.updateOne({ shortId: req.params.id }, { isActive: !result.isActive });
  await delCachedUrl(req.params.id);
  const ref = req.headers.referer || "/";
  return res.redirect(ref);
}

module.exports = {
  handleGenerateNewShortURL,
  handleRedirectToURL,
  handleUnlockURL,
  handleAnayticsOfURL,
  handleExportAnalyticsCSV,
  handleEditURL,
  handleDeleteURL,
  handleToggleURL,
  isBotUserAgent,
  isValidHttpUrl,
  isValidAlias,
  appendUtmParams,
  parseTags,
  filterVisitsByRange,
  escapeCsvCell,
  aggregate,
};
