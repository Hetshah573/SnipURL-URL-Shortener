require("dotenv").config(); // Must be first — loads .env before anything else

const express = require("express");
const cookieParser = require("cookie-parser");
const helmet = require("helmet");
const mongoose = require("mongoose");
const swaggerUi = require("swagger-ui-express");
const path = require("path");

const connectMongoDb = require("./connection.js");
const staticroute = require("./routes/staticroute.js");
const urlroute = require("./routes/url");
const userroute = require("./routes/user.js");
const apiroute = require("./routes/api.js");
const { checkAuth } = require("./middlewares/auth.js");
const { csrfProtection } = require("./middlewares/csrf.js");
const requestLogger = require("./middlewares/requestLogger.js");
const { getRedisClient, isRedisReady, closeRedis } = require("./service/cache.js");
const { initClickQueue, closeClickQueue } = require("./service/clickQueue.js");
const logger = require("./service/logger.js");
const swaggerSpec = require("./service/swagger.js");

const app = express();
app.set("trust proxy", 1);
const PORT = process.env.PORT || 5000;

// ── Database ──────────────────────────────────────────────────────────────────
connectMongoDb(process.env.MONGO_URI)
  .then(() => {
    logger.info("MongoDB connected successfully");
  })
  .catch((err) => {
    logger.error({ err: err.message }, "MongoDB connection failed");
    process.exit(1);
  });

// ── View engine ───────────────────────────────────────────────────────────────
app.set("view engine", "ejs");
app.set("views", path.resolve("./views"));

// ── Security & Logging middleware ─────────────────────────────────────────────
app.use(requestLogger);
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com"],
        imgSrc: ["'self'", "data:"],
      },
    },
  })
);

// ── Body, cookie & CSRF parsers ───────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(csrfProtection);

// ── Routes ────────────────────────────────────────────────────────────────────
app.get("/health", (req, res) => {
  res.json({
    ok: true,
    mongo: mongoose.connection.readyState === 1 ? "connected" : "disconnected",
    redis: isRedisReady() ? "connected" : "fallback",
  });
});
app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));
app.use("/api/v1", apiroute);
app.use("/url", urlroute);
app.use("/", checkAuth, staticroute);
app.use("/user", userroute);

// Initialize Redis cache & BullMQ async click worker
getRedisClient();
initClickQueue();

// ── Global error handler ──────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  const log = req.log || logger;
  log.error({ err: err.stack }, "Unhandled error");
  res.status(500).render("error", { message: "Something went wrong. Please try again." });
});

// ── Start server ──────────────────────────────────────────────────────────────
const server = app.listen(PORT, () => {
  logger.info({ port: PORT }, "Server running");
});

// ── Graceful shutdown ─────────────────────────────────────────────────────────
process.on("SIGTERM", async () => {
  logger.info("SIGTERM received — shutting down gracefully");
  await closeClickQueue();
  await closeRedis();
  server.close(() => {
    logger.info("HTTP server closed");
    process.exit(0);
  });
});
