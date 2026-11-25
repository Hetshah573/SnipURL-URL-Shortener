const jwt = require("jsonwebtoken");

const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "7d";

/**
 * Signs a JWT token containing the user payload.
 * @param {Object} user - Mongoose user document (or plain object with _id, name, email)
 * @returns {string} Signed JWT string
 */
function setUser(user) {
  return jwt.sign(
    {
      _id: user._id,
      name: user.name,
      email: user.email,
    },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
}

/**
 * Verifies and decodes a JWT token.
 * Returns the decoded payload or null if invalid / expired.
 * @param {string} token
 * @returns {Object|null}
 */
function getUser(token) {
  if (!token) return null;
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}

module.exports = { setUser, getUser };
