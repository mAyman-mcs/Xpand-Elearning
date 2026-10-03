import { randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { pino, type Logger } from "pino";
import { pinoHttp } from "pino-http";
import type { Config } from "./config.js";

/** Paths never written to logs. */
const REDACT = [
  "req.headers.cookie",
  "req.headers.authorization",
  'res.headers["set-cookie"]',
  "*.password",
  "*.currentPassword",
  "*.newPassword",
  "*.passwordHash",
  "*.token",
  "*.tokenHash",
];

export function createLogger(config: Pick<Config, "LOG_LEVEL" | "NODE_ENV">): Logger {
  return pino({
    level: config.LOG_LEVEL,
    redact: { paths: REDACT, censor: "[redacted]" },
    base: { service: "xpand-portal" },
  });
}

export function createHttpLogger(logger: Logger) {
  return pinoHttp({
    logger,
    genReqId: (req: IncomingMessage) => {
      const incoming = req.headers["x-request-id"];
      return typeof incoming === "string" && /^[\w-]{8,64}$/.test(incoming) ? incoming : randomUUID();
    },
    customProps: (req) => ({ userId: (req as Express.Request).auth?.user.id }),
    customLogLevel: (_req, res, err) =>
      err || res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "warn" : "info",
    // Health probes every few seconds would drown the log.
    autoLogging: { ignore: (req) => req.url?.startsWith("/api/health") ?? false },
  });
}
