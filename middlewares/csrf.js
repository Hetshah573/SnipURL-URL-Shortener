const crypto = require("crypto");

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Double-submit cookie CSRF protection for HTML form routes.
 * - Sets a `csrf_token` cookie if missing and exposes `res.locals.csrfToken` to EJS views.
 * - Verifies `req.body._csrf` or `x-csrf-token` header on state-changing requests.
 * - Skips `/api/` routes (authenticated via Bearer/API key, not browser cookies).
 */
function csrfProtection(req, res, next) {
  if (req.path.startsWith("/api/")) return next();

  let token = req.cookies?.csrf_token;
  if (!token) {
    token = crypto.randomBytes(32).toString("hex");
    res.cookie("csrf_token", token, {
      httpOnly: false, // readable if needed by client scripts; verified via double-submit
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
    });
  }

  res.locals.csrfToken = token;

  if (SAFE_METHODS.has(req.method) || process.env.DISABLE_CSRF === "true") {
    return next();
  }

  const submitted = req.body?._csrf || req.headers["x-csrf-token"];
  if (!submitted || typeof submitted !== "string" || submitted.length !== token.length) {
    return res.status(403).render("error", {
      message: "Invalid or missing CSRF token. Please refresh the page and try again.",
    });
  }

  const valid = crypto.timingSafeEqual(Buffer.from(submitted), Buffer.from(token));
  if (!valid) {
    return res.status(403).render("error", {
      message: "Invalid or missing CSRF token. Please refresh the page and try again.",
    });
  }

  next();
}

module.exports = { csrfProtection };
