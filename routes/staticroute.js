const express = require("express");
const URL = require("../models/url");
const User = require("../models/user");
const router = express.Router();

const PAGE_SIZE = 10;

// Home / dashboard — supports ?q= (search), ?sort= (newest|oldest|most_clicked), ?page=
router.get("/", async (req, res) => {
  if (!req.user) return res.redirect("/login");

  const allurls = await URL.find({ createdBy: req.user._id }).sort({ createdAt: -1 });
  const userDoc = await User.findOne({ _id: req.user._id });

  // One-time flash for newly generated API key
  const newApiKey = req.cookies?.new_api_key || null;
  if (newApiKey) res.clearCookie("new_api_key");

  // Banner for newly created short URL (PRG)
  const createdId = req.query.created;
  const createdUrl = createdId ? allurls.find((u) => u.shortId === createdId) : null;

  // Search filter
  const q = (req.query.q || "").trim();
  let filtered = allurls;
  if (q) {
    const lower = q.toLowerCase();
    filtered = allurls.filter(
      (u) =>
        u.shortId.toLowerCase().includes(lower) ||
        u.redirectId.toLowerCase().includes(lower)
    );
  }

  // Sort
  const sort = req.query.sort || "newest";
  if (sort === "oldest") {
    filtered = [...filtered].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  } else if (sort === "most_clicked") {
    filtered = [...filtered].sort((a, b) => b.visitHistory.length - a.visitHistory.length);
  }

  // Pagination
  const totalFiltered = filtered.length;
  const totalPages = Math.max(1, Math.ceil(totalFiltered / PAGE_SIZE));
  const page = Math.min(Math.max(1, parseInt(req.query.page, 10) || 1), totalPages);
  const start = (page - 1) * PAGE_SIZE;
  const pagedUrls = filtered.slice(start, start + PAGE_SIZE);

  return res.render("home", {
    urls: pagedUrls,
    totalLinks: allurls.length,
    totalFiltered,
    name: req.user.name,
    deleted: req.query.deleted === "1",
    newShortId: createdUrl ? createdUrl.shortId : null,
    newShortUrl: createdUrl ? `${req.protocol}://${req.get("host")}/url/${createdUrl.shortId}` : null,
    q,
    sort,
    page,
    totalPages,
    apiKeyPrefix: userDoc?.apiKeyPrefix || null,
    newApiKey,
  });
});

// Login & Signup pages
router.get("/login", (req, res) => {
  if (req.user) return res.redirect("/");
  const registered = req.query.registered === "1";
  return res.render("login", { success: registered ? "Account created! Please log in." : null });
});

router.get("/signup", (req, res) => {
  if (req.user) return res.redirect("/");
  return res.render("signup", {});
});

module.exports = router;
