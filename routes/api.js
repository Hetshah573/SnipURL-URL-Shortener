const express = require("express");
const shortid = require("shortid");
const URL = require("../models/url");
const { authenticateApiKey } = require("../middlewares/apiAuth");
const { urlShortenLimiter } = require("../middlewares/rateLimiter");
const { isValidHttpUrl, isValidAlias, aggregate } = require("../controllers/url");
const { setCachedUrl, delCachedUrl } = require("../service/cache");

const router = express.Router();

// All /api/v1 routes require a valid API key
router.use(authenticateApiKey);

/**
 * POST /api/v1/shorten
 * Body: { url, customAlias?, expiresAt? }
 */
router.post("/shorten", urlShortenLimiter, async (req, res) => {
  const { url: originalUrl, customAlias, expiresAt } = req.body;

  if (!originalUrl || !isValidHttpUrl(originalUrl)) {
    return res.status(400).json({ error: "A valid http:// or https:// url is required." });
  }

  const existingOriginal = await URL.findOne({ redirectId: originalUrl, createdBy: req.user._id });
  if (existingOriginal) {
    return res.status(409).json({
      error: "You already shortened this URL.",
      shortId: existingOriginal.shortId,
      shortUrl: `${req.protocol}://${req.get("host")}/url/${existingOriginal.shortId}`,
    });
  }

  let shortId;
  if (customAlias && customAlias.trim()) {
    const alias = customAlias.trim();
    if (!isValidAlias(alias)) {
      return res.status(400).json({ error: "customAlias must be 3–30 chars (letters, numbers, - or _)." });
    }
    if (await URL.findOne({ shortId: alias })) {
      return res.status(409).json({ error: `Alias "${alias}" is already taken.` });
    }
    shortId = alias;
  } else {
    shortId = shortid();
  }

  let expiry = null;
  if (expiresAt) {
    expiry = new Date(expiresAt);
    if (isNaN(expiry.getTime()) || expiry <= new Date()) {
      return res.status(400).json({ error: "expiresAt must be a valid future date." });
    }
  }

  const created = await URL.create({
    shortId,
    redirectId: originalUrl,
    visitHistory: [],
    createdBy: req.user._id,
    expiresAt: expiry,
  });

  await setCachedUrl(shortId, created);

  return res.status(201).json({
    shortId,
    shortUrl: `${req.protocol}://${req.get("host")}/url/${shortId}`,
    redirectId: originalUrl,
    expiresAt: expiry,
  });
});

/**
 * GET /api/v1/links?q=&sort=&page=&limit=
 */
router.get("/links", async (req, res) => {
  const allurls = await URL.find({ createdBy: req.user._id }).sort({ createdAt: -1 });

  const q = (req.query.q || "").trim().toLowerCase();
  let filtered = q
    ? allurls.filter((u) => u.shortId.toLowerCase().includes(q) || u.redirectId.toLowerCase().includes(q))
    : allurls;

  const sort = req.query.sort || "newest";
  if (sort === "oldest") {
    filtered = [...filtered].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  } else if (sort === "most_clicked") {
    filtered = [...filtered].sort((a, b) => b.visitHistory.length - a.visitHistory.length);
  }

  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 10));
  const totalPages = Math.max(1, Math.ceil(filtered.length / limit));
  const page = Math.min(Math.max(1, parseInt(req.query.page, 10) || 1), totalPages);
  const items = filtered.slice((page - 1) * limit, page * limit);

  return res.json({
    links: items.map((u) => ({
      shortId: u.shortId,
      redirectId: u.redirectId,
      totalClicks: u.visitHistory.length,
      humanClicks: u.visitHistory.filter((v) => !v.isBot).length,
      isActive: u.isActive,
      expiresAt: u.expiresAt,
      createdAt: u.createdAt,
    })),
    pagination: { page, limit, total: filtered.length, totalPages },
  });
});

/**
 * GET /api/v1/analytics/:id
 */
router.get("/analytics/:id", async (req, res) => {
  const doc = await URL.findOne({ shortId: req.params.id, createdBy: req.user._id });
  if (!doc) return res.status(404).json({ error: "Link not found." });

  const humanVisits = doc.visitHistory.filter((v) => !v.isBot);
  return res.json({
    shortId: doc.shortId,
    redirectId: doc.redirectId,
    totalClicks: doc.visitHistory.length,
    humanClicks: humanVisits.length,
    botClicks: doc.visitHistory.length - humanVisits.length,
    uniqueClicks: new Set(humanVisits.map((v) => v.ip)).size,
    topBrowsers: aggregate(humanVisits.map((v) => v.browser)),
    topCountries: aggregate(humanVisits.map((v) => v.country)),
    topReferrers: aggregate(humanVisits.map((v) => v.referrer)),
  });
});

/**
 * PATCH /api/v1/links/:id
 * Body: { redirectId }
 */
router.patch("/links/:id", async (req, res) => {
  const { redirectId } = req.body;
  if (!redirectId || !isValidHttpUrl(redirectId)) {
    return res.status(400).json({ error: "A valid http:// or https:// redirectId is required." });
  }

  const doc = await URL.findOne({ shortId: req.params.id, createdBy: req.user._id });
  if (!doc) return res.status(404).json({ error: "Link not found." });

  await URL.updateOne({ shortId: req.params.id }, { redirectId });
  await delCachedUrl(req.params.id);

  return res.json({ shortId: doc.shortId, redirectId, updated: true });
});

/**
 * DELETE /api/v1/links/:id
 */
router.delete("/links/:id", async (req, res) => {
  const doc = await URL.findOne({ shortId: req.params.id, createdBy: req.user._id });
  if (!doc) return res.status(404).json({ error: "Link not found." });

  await URL.deleteOne({ shortId: req.params.id });
  await delCachedUrl(req.params.id);

  return res.json({ shortId: doc.shortId, deleted: true });
});

module.exports = router;
