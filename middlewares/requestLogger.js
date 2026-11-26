const crypto = require("crypto");
const logger = require("../service/logger");

/**
 * Attaches a unique Request ID (X-Request-Id) and child logger (req.log).
 * Keeps console clean by logging only errors (5xx), warnings (4xx), slow requests (>1s),
 * or all requests at debug level (set LOG_LEVEL=debug to see everything).
 */
function requestLogger(req, res, next) {
  const reqId = req.headers["x-request-id"] || crypto.randomUUID();
  const start = process.hrtime.bigint();

  req.id = reqId;
  req.log = logger.child({ reqId });
  res.setHeader("X-Request-Id", reqId);

  res.on("finish", () => {
    const durationMs = Math.round((Number(process.hrtime.bigint() - start) / 1e6) * 100) / 100;
    const meta = {
      method: req.method,
      url: req.originalUrl || req.url,
      status: res.statusCode,
      durationMs,
    };

    if (res.statusCode >= 500) {
      req.log.error(meta, "request error");
    } else if (res.statusCode >= 400 || durationMs > 1000) {
      req.log.warn(meta, durationMs > 1000 ? "slow request" : "client error");
    } else {
      req.log.debug(meta, "request completed");
    }
  });

  next();
}

module.exports = requestLogger;
