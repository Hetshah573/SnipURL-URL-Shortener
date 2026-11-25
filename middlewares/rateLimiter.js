const rateLimit = require("express-rate-limit");

/**
 * Strict limiter for login — prevents brute-force attacks.
 * Max 10 attempts per IP per 15 minutes.
 */
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
  message: "Too many login attempts. Please try again after 15 minutes.",
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Limiter for signup — prevents mass account creation.
 * Max 5 accounts per IP per hour.
 */
const signupLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5,
  message: "Too many accounts created from this IP. Please try again later.",
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * General API limiter for URL shortening endpoint.
 * Max 30 short URLs per IP per 15 minutes.
 */
const urlShortenLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 30,
  message: "You're shortening URLs too fast. Please slow down.",
  standardHeaders: true,
  legacyHeaders: false,
});

module.exports = { loginLimiter, signupLimiter, urlShortenLimiter };
