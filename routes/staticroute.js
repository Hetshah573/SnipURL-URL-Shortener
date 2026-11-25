const express = require("express");
const URL = require("../models/url");
const router = express.Router();

// Home / dashboard — requires auth (redirects handled by checkAuth + route guard)
router.get("/", async (req, res) => {
  if (!req.user) return res.redirect("/login");
  const allurls = await URL.find({ createdBy: req.user._id }).sort({ createdAt: -1 });
  const createdId = req.query.created;
  const createdUrl = createdId ? allurls.find((u) => u.shortId === createdId) : null;
  return res.render("home", {
    urls: allurls,
    name: req.user.name,
    deleted: req.query.deleted === "1",
    newShortId: createdUrl ? createdUrl.shortId : null,
    newShortUrl: createdUrl ? `${req.protocol}://${req.get("host")}/url/${createdUrl.shortId}` : null,
  });
});

// Login & Signup pages (served from staticroute so checkAuth runs & we know logged-in state)
router.get("/login", (req, res) => {
  if (req.user) return res.redirect("/"); // already logged in
  const registered = req.query.registered === "1";
  return res.render("login", { success: registered ? "Account created! Please log in." : null });
});

router.get("/signup", (req, res) => {
  if (req.user) return res.redirect("/"); // already logged in
  return res.render("signup", {});
});

module.exports = router;
