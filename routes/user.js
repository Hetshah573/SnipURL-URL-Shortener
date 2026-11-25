const express = require("express");
const {
  handleUserSignup,
  handleUserLogin,
  handleUserLogout,
  handleGenerateApiKey,
  handleRevokeApiKey,
} = require("../controllers/user");
const { loginLimiter, signupLimiter } = require("../middlewares/rateLimiter");
const { restrictToLoggedInUserOnly } = require("../middlewares/auth");

const router = express.Router();

// GET pages
router.get("/login", (req, res) => res.render("login", {}));
router.get("/signup", (req, res) => res.render("signup", {}));

// POST actions (rate-limited)
router.post("/", signupLimiter, handleUserSignup);
router.post("/login", loginLimiter, handleUserLogin);
router.get("/logout", handleUserLogout);

// API Key management (auth required)
router.post("/api-key", restrictToLoggedInUserOnly, handleGenerateApiKey);
router.post("/api-key/revoke", restrictToLoggedInUserOnly, handleRevokeApiKey);

module.exports = router;
