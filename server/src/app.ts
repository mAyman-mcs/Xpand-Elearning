import { existsSync } from "node:fs";
import path from "node:path";
import cookieParser from "cookie-parser";
import express, { type RequestHandler } from "express";
import helmet from "helmet";
import type { AppDeps } from "./core/context.js";
import { AppError, createErrorHandler } from "./core/errors.js";
import { createHttpLogger } from "./core/logger.js";
import { publicHandler, type ApiRouter } from "./core/route.js";
import { assignmentsRoutes, overridesRoutes, studentRoutes } from "./modules/assignments/routes.js";
import { authRoutes, sessionLoader } from "./modules/auth/routes.js";
import { catalogRoutes } from "./modules/catalog/routes.js";
import { groupsRoutes } from "./modules/groups/routes.js";
import { healthRoutes } from "./modules/health/routes.js";
import { meRoutes, rbacRoutes } from "./modules/rbac/routes.js";
import { usersRoutes } from "./modules/users/routes.js";

/** API modules and where they are mounted under /api. */
function modules(deps: AppDeps): [string, ApiRouter][] {
  return [
    ["/health", healthRoutes(deps)],
    ["/auth", authRoutes(deps)],
    ["/me", meRoutes(deps)],
    ["/rbac", rbacRoutes(deps)],
    ["/users", usersRoutes(deps)],
    ["/groups", groupsRoutes(deps)],
    ["/catalog", catalogRoutes(deps)],
    ["/assignments", assignmentsRoutes(deps)],
    ["/overrides", overridesRoutes(deps)],
    ["/student", studentRoutes(deps)],
  ];
}

/** Every API route as "METHOD /api/path" with its access policy — the source for the RBAC matrix. */
export function apiRouteTable(deps: AppDeps) {
  return modules(deps).flatMap(([prefix, module]) =>
    module.routes.map((r) => ({
      key: `${r.method.toUpperCase()} /api${prefix}${r.path === "/" ? "" : r.path}`,
      access: r.access,
    })),
  );
}

/**
 * Blocks cross-site form posts: state-changing API calls must be JSON, which a foreign page
 * cannot send without a CORS preflight (and no cross-origin requests are allowed).
 * Works together with the SameSite=Strict session cookie.
 */
const requireJsonForWrites: RequestHandler = (req, _res, next) => {
  if (["POST", "PUT", "PATCH", "DELETE"].includes(req.method) && !req.is("application/json")) {
    next(new AppError("UNSUPPORTED_MEDIA_TYPE"));
    return;
  }
  next();
};

export function createApp(deps: AppDeps) {
  const { config, logger } = deps;
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
  app.use(createHttpLogger(logger));
  app.use(express.json({ limit: "100kb" }));
  app.use(cookieParser());

  const api = express.Router();
  api.use(requireJsonForWrites);
  api.use(sessionLoader(deps));
  for (const [prefix, module] of modules(deps)) api.use(prefix, module.router);
  api.use(
    publicHandler(() => {
      throw new AppError("NOT_FOUND");
    }),
  );
  app.use("/api", api);

  // Serve the built React app (Docker image); in development Vite serves it instead.
  const webDist = config.WEB_DIST ?? path.resolve(import.meta.dirname, "../public");
  if (existsSync(webDist)) {
    app.use(express.static(webDist, { index: false, maxAge: "1h" }));
    app.get(
      "/{*path}",
      publicHandler((_req, res) => {
        res.set("Cache-Control", "no-store");
        res.sendFile(path.join(webDist, "index.html"));
      }),
    );
  }

  app.use(createErrorHandler(logger));
  return app;
}
