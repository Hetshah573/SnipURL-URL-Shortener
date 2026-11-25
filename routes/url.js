const express = require("express");
const {
  handleGenerateNewShortURL,
  handleRedirectToURL,
  handleAnayticsOfURL,
  handleDeleteURL,
  handleToggleURL,
} = require("../controllers/url");
const { restrictToLoggedInUserOnly } = require("../middlewares/auth");
const { urlShortenLimiter } = require("../middlewares/rateLimiter");

const router = express.Router();

// ── IMPORTANT: specific routes MUST come before /:id wildcard ─────────────────

// Create short URL
router.post("/", restrictToLoggedInUserOnly, urlShortenLimiter, handleGenerateNewShortURL);

// Analytics page  (before /:id so "analytics" isn't caught as an id)
router.get("/analytics/:id", restrictToLoggedInUserOnly, handleAnayticsOfURL);

// Delete a URL (POST since HTML forms don't support DELETE)
router.post("/delete/:id", restrictToLoggedInUserOnly, handleDeleteURL);

// Toggle active/inactive
router.post("/toggle/:id", restrictToLoggedInUserOnly, handleToggleURL);

// Redirect — MUST be last (wildcard)
router.get("/:id", handleRedirectToURL);

module.exports = router;
