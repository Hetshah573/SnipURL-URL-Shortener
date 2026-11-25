const bcrypt = require("bcryptjs");
const User = require("../models/user");
const { setUser } = require("../service/auth");

const SALT_ROUNDS = 10;

async function handleUserSignup(req, res) {
  const { name, email, password } = req.body;

  // Basic server-side validation
  if (!name || !email || !password) {
    return res.render("signup", { error: "All fields are required." });
  }
  if (password.length < 6) {
    return res.render("signup", { error: "Password must be at least 6 characters." });
  }

  // Check if email already taken
  const existing = await User.findOne({ email });
  if (existing) {
    return res.render("signup", { error: "An account with this email already exists." });
  }

  // Hash password before saving
  const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);

  await User.create({ name, email, password: hashedPassword });

  return res.redirect("/login?registered=1");
}

async function handleUserLogin(req, res) {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.render("login", { error: "Email and password are required." });
  }

  const user = await User.findOne({ email });

  // Always run bcrypt compare to avoid timing attacks (even if user not found)
  const dummyHash = "$2a$10$invalidhashfortimingnormalization00000000000000000000000";
  const isMatch = user
    ? await bcrypt.compare(password, user.password)
    : await bcrypt.compare(password, dummyHash).then(() => false);

  if (!user || !isMatch) {
    return res.render("login", { error: "Invalid email or password." });
  }

  // Issue a JWT and store it in an httpOnly cookie
  const token = setUser(user);
  res.cookie("token", token, {
    httpOnly: true,      // JS cannot access — prevents XSS token theft
    secure: process.env.NODE_ENV === "production", // HTTPS-only in prod
    sameSite: "lax",     // CSRF mitigation
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days in ms
  });

  return res.redirect("/");
}

async function handleUserLogout(req, res) {
  res.clearCookie("token");
  return res.redirect("/login");
}

module.exports = { handleUserSignup, handleUserLogin, handleUserLogout };
