const express = require("express");
const {
  handleGenerateNewShortURL,
  handleRedirectToURL,
  handleUnlockURL,
  handleAnayticsOfURL,
  handleExportAnalyticsCSV,
  handleEditURL,
  handleDeleteURL,
  handleToggleURL,
} = require("../controllers/url");
const { restrictToLoggedInUserOnly } = require("../middlewares/auth");
const { urlShortenLimiter } = require("../middlewares/rateLimiter");

const router = express.Router();

// ── IMPORTANT: specific routes MUST come before /:id wildcard ─────────────────

// Create short URL
router.post("/", restrictToLoggedInUserOnly, urlShortenLimiter, handleGenerateNewShortURL);

// Analytics & CSV Export
router.get("/analytics/:id/export", restrictToLoggedInUserOnly, handleExportAnalyticsCSV);
router.get("/analytics/:id", restrictToLoggedInUserOnly, handleAnayticsOfURL);

// Edit destination URL
router.post("/edit/:id", restrictToLoggedInUserOnly, handleEditURL);

// Delete a URL
router.post("/delete/:id", restrictToLoggedInUserOnly, handleDeleteURL);

// Toggle active/inactive
router.post("/toggle/:id", restrictToLoggedInUserOnly, handleToggleURL);

// Unlock password-protected link (public)
router.post("/:id/unlock", handleUnlockURL);

// Redirect — MUST be last (wildcard)
router.get("/:id", handleRedirectToURL);

module.exports = router;
