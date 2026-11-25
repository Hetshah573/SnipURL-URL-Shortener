const express = require("express");
const { handleUserSignup, handleUserLogin, handleUserLogout } = require("../controllers/user");
const { loginLimiter, signupLimiter } = require("../middlewares/rateLimiter");

const router = express.Router();

// GET pages
router.get("/login", (req, res) => res.render("login", {}));
router.get("/signup", (req, res) => res.render("signup", {}));

// POST actions (rate-limited)
router.post("/", signupLimiter, handleUserSignup);
router.post("/login", loginLimiter, handleUserLogin);
router.get("/logout", handleUserLogout);

module.exports = router;
