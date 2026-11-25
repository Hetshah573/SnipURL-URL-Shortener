const express = require("express");
const URL = require("../models/url");
const User = require("../models/user");
const router = express.Router();

const PAGE_SIZE = 10;

// Home / dashboard — supports ?q= (search), ?tag= (tag filter), ?sort=, ?page=
router.get("/", async (req, res) => {
  if (!req.user) return res.redirect("/login");

  const allurls = await URL.find({ createdBy: req.user._id }).sort({ createdAt: -1 });
  const userDoc = await User.findOne({ _id: req.user._id });

  const newApiKey = req.cookies?.new_api_key || null;
  if (newApiKey) res.clearCookie("new_api_key");

  const createdId = req.query.created;
  const createdUrl = createdId ? allurls.find((u) => u.shortId === createdId) : null;

  // Collect all unique tags across user's links
  const allTags = [...new Set(allurls.flatMap((u) => u.tags || []))].sort();

  // Search & Tag filter
  const q = (req.query.q || "").trim();
  const tag = (req.query.tag || "").trim().toLowerCase();
  let filtered = allurls;
  if (q) {
    const lower = q.toLowerCase();
    filtered = filtered.filter(
      (u) =>
        u.shortId.toLowerCase().includes(lower) ||
        u.redirectId.toLowerCase().includes(lower) ||
        (u.tags || []).some((t) => t.includes(lower))
    );
  }
  if (tag) {
    filtered = filtered.filter((u) => (u.tags || []).includes(tag));
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
    tag,
    allTags,
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
