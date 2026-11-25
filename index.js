require("dotenv").config(); // Must be first — loads .env before anything else

const express = require("express");
const cookieParser = require("cookie-parser");
const helmet = require("helmet");
const path = require("path");

const connectMongoDb = require("./connection.js");
const staticroute = require("./routes/staticroute.js");
const urlroute = require("./routes/url");
const userroute = require("./routes/user.js");
const { restrictToLoggedInUserOnly, checkAuth } = require("./middlewares/auth.js");

const app = express();
const PORT = process.env.PORT || 5000;

// ── Database ──────────────────────────────────────────────────────────────────
connectMongoDb(process.env.MONGO_URI).then(() => {
  console.log("MongoDB connected successfully");
}).catch((err) => {
  console.error("MongoDB connection failed:", err.message);
  process.exit(1);
});

// ── View engine ───────────────────────────────────────────────────────────────
app.set("view engine", "ejs");
app.set("views", path.resolve("./views"));

// ── Security middleware ───────────────────────────────────────────────────────
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net"], // Chart.js CDN
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com"],
        imgSrc: ["'self'", "data:"],
      },
    },
  })
);

// ── Body & cookie parsers ─────────────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());

// ── Routes ────────────────────────────────────────────────────────────────────
app.use("/url", urlroute);
app.use("/", checkAuth, staticroute);
app.use("/user", userroute);

// ── Global error handler ──────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err.stack);
  res.status(500).render("error", { message: "Something went wrong. Please try again." });
});

// ── Start server ──────────────────────────────────────────────────────────────
const server = app.listen(PORT, () => {
  console.log(`Server running on PORT ${PORT}`);
});

// ── Graceful shutdown ─────────────────────────────────────────────────────────
process.on("SIGTERM", () => {
  console.log("SIGTERM received — shutting down gracefully");
  server.close(() => {
    console.log("HTTP server closed");
    process.exit(0);
  });
});
