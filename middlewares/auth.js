const { getUser } = require("../service/auth");

/**
 * Blocks unauthenticated users — redirects to /login.
 * Attaches decoded user payload to req.user on success.
 */
async function restrictToLoggedInUserOnly(req, res, next) {
  const token = req.cookies?.token;
  const user = getUser(token);

  if (!user) {
    return res.redirect("/login");
  }

  req.user = user;
  next();
}

/**
 * Soft auth check — does NOT block.
 * Attaches decoded user payload to req.user if token is valid, otherwise null.
 * Useful for pages that behave differently when logged in vs not.
 */
async function checkAuth(req, res, next) {
  const token = req.cookies?.token;
  req.user = getUser(token); // null if missing/invalid/expired
  next();
}

module.exports = { restrictToLoggedInUserOnly, checkAuth };
