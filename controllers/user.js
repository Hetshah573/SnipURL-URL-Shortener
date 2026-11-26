const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const User = require("../models/user");
const { setUser } = require("../service/auth");
const { hashApiKey } = require("../middlewares/apiAuth");
const { signupSchema, loginSchema } = require("../validators/schemas");

const SALT_ROUNDS = 10;

async function handleUserSignup(req, res) {
  const parsed = signupSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.render("signup", { error: parsed.error.issues[0]?.message || "Invalid input." });
  }
  const { name, email, password } = parsed.data;

  const existing = await User.findOne({ email });
  if (existing) {
    return res.render("signup", { error: "An account with this email already exists." });
  }

  const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);
  await User.create({ name, email, password: hashedPassword });

  return res.redirect("/login?registered=1");
}

async function handleUserLogin(req, res) {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.render("login", { error: parsed.error.issues[0]?.message || "Invalid credentials." });
  }
  const { email, password } = parsed.data;

  const user = await User.findOne({ email });

  const dummyHash = "$2a$10$invalidhashfortimingnormalization00000000000000000000000";
  const isMatch = user
    ? await bcrypt.compare(password, user.password)
    : await bcrypt.compare(password, dummyHash).then(() => false);

  if (!user || !isMatch) {
    return res.render("login", { error: "Invalid email or password." });
  }

  const token = setUser(user);
  res.cookie("token", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });

  return res.redirect("/");
}

async function handleUserLogout(req, res) {
  res.clearCookie("token");
  return res.redirect("/login");
}

/** Generates (or regenerates) a per-user REST API key and flashes it once via httpOnly cookie. */
async function handleGenerateApiKey(req, res) {
  const rawKey = `snip_${crypto.randomBytes(24).toString("hex")}`;
  const prefix = `${rawKey.slice(0, 11)}••••`;

  await User.updateOne(
    { _id: req.user._id },
    { apiKeyHash: hashApiKey(rawKey), apiKeyPrefix: prefix }
  );

  // Flash raw key once via short-lived httpOnly cookie so it stays out of URLs
  res.cookie("new_api_key", rawKey, {
    httpOnly: true,
    sameSite: "lax",
    maxAge: 60 * 1000,
  });

  return res.redirect("/");
}

async function handleRevokeApiKey(req, res) {
  await User.updateOne(
    { _id: req.user._id },
    { apiKeyHash: null, apiKeyPrefix: null }
  );
  return res.redirect("/");
}

module.exports = {
  handleUserSignup,
  handleUserLogin,
  handleUserLogout,
  handleGenerateApiKey,
  handleRevokeApiKey,
};
