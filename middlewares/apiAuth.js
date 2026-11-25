const crypto = require("crypto");
const User = require("../models/user");

/** Hashes a raw API key using SHA-256 for constant-lookup storage. */
function hashApiKey(rawKey) {
  return crypto.createHash("sha256").update(rawKey).digest("hex");
}

/**
 * Authenticates REST API requests via `Authorization: Bearer <key>` or `x-api-key: <key>`.
 */
async function authenticateApiKey(req, res, next) {
  const authHeader = req.headers["authorization"] || "";
  const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : null;
  const rawKey = bearer || req.headers["x-api-key"];

  if (!rawKey) {
    return res.status(401).json({
      error: "Missing API key. Provide Authorization: Bearer <key> or x-api-key header.",
    });
  }

  const user = await User.findOne({ apiKeyHash: hashApiKey(rawKey) });
  if (!user) {
    return res.status(401).json({ error: "Invalid or revoked API key." });
  }

  req.user = user;
  next();
}

module.exports = { authenticateApiKey, hashApiKey };
