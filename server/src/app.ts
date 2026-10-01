import { existsSync } from "node:fs";
import path from "node:path";
import cookieParser from "cookie-parser";
import express, { type ErrorRequestHandler } from "express";
import helmet from "helmet";
import { loadSession, requireJsonForWrites } from "./auth/middleware.js";
import { authRouter } from "./auth/routes.js";
import { config } from "./config.js";
import { prisma } from "./db.js";

export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", config.TRUST_PROXY);

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          imgSrc: ["'self'", "data:", "https:"],
          frameSrc: ["'self'", "https://docs.google.com", "https://drive.google.com"],
          frameAncestors: ["'none'"],
          // Only meaningful behind HTTPS; on a plain-http host it would break same-origin assets.
          upgradeInsecureRequests: config.COOKIE_SECURE ? [] : null,
        },
      },
    }),
  );
  app.use(express.json({ limit: "100kb" }));
  app.use(cookieParser());

  const api = express.Router();
  api.use(requireJsonForWrites);
  api.use(loadSession);

  api.get("/health", async (_req, res) => {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ ok: true });
  });
  api.use("/auth", authRouter);
  api.use((_req, res) => {
    res.status(404).json({ error: "NOT_FOUND" });
  });

  app.use("/api", api);

  // Serve the built React app (Docker image); in development Vite serves it instead.
  const webDist = config.WEB_DIST ?? path.resolve(import.meta.dirname, "../public");
  if (existsSync(webDist)) {
    app.use(express.static(webDist, { index: false, maxAge: "1h" }));
    app.get("/{*path}", (_req, res) => {
      res.set("Cache-Control", "no-store");
      res.sendFile(path.join(webDist, "index.html"));
    });
  }

  const onError: ErrorRequestHandler = (err, _req, res, _next) => {
    // Client errors raised by middleware (malformed JSON → 400, body too large → 413).
    const status: unknown = err?.status;
    if (typeof status === "number" && status >= 400 && status < 500) {
      if (!res.headersSent) res.status(status).json({ error: status === 413 ? "PAYLOAD_TOO_LARGE" : "INVALID_REQUEST" });
      return;
    }
    console.error(err);
    if (res.headersSent) return;
    res.status(500).json({ error: "INTERNAL_ERROR" });
  };
  app.use(onError);

  return app;
}
