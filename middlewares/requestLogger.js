const crypto = require("crypto");
const logger = require("../service/logger");

/**
 * Attaches a unique Request ID (X-Request-Id), child logger (req.log),
 * and logs structured JSON request completion metrics.
 */
function requestLogger(req, res, next) {
  const reqId = req.headers["x-request-id"] || crypto.randomUUID();
  const start = process.hrtime.bigint();

  req.id = reqId;
  req.log = logger.child({ reqId });
  res.setHeader("X-Request-Id", reqId);

  res.on("finish", () => {
    const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
    req.log.info(
      {
        method: req.method,
        url: req.originalUrl || req.url,
        status: res.statusCode,
        durationMs: Math.round(durationMs * 100) / 100,
      },
      "request completed"
    );
  });

  next();
}

module.exports = requestLogger;
