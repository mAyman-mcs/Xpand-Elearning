// Started by Playwright (webServer): a fresh xpand_e2e database, then the BUILT server serving the
// BUILT web app on one origin, as in production (docs/ADMIN_DASHBOARD_PLAN.md §5.1).
//   E2E_ADMIN_DATABASE_URL  a maintenance connection on the same Postgres (default: the dev container)
import { execFileSync, spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const adminUrl = process.env.E2E_ADMIN_DATABASE_URL ?? "postgresql://xpand:xpand-dev@localhost:5433/postgres";
const dbName = "xpand_e2e";
const databaseUrl = Object.assign(new URL(adminUrl), { pathname: `/${dbName}` }).toString();
const port = process.env.E2E_PORT ?? "8090";

const admin = new pg.Client({ connectionString: adminUrl });
await admin.connect();
await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
await admin.query(`CREATE DATABASE ${dbName}`);
await admin.end();

const env = {
  ...process.env,
  NODE_ENV: "production",
  PORT: port,
  DATABASE_URL: databaseUrl,
  COOKIE_SECURE: "false", // plain http on localhost
  BCRYPT_COST: "4",
  LOGIN_RATE_LIMIT: "10000",
  LOG_LEVEL: process.env.E2E_LOG_LEVEL ?? "warn",
  WEB_DIST: path.join(root, "web", "dist"),
};
const server = path.join(root, "server");
const run = (args) => execFileSync(process.execPath, args, { cwd: server, env, stdio: "inherit" });

run([path.join(root, "node_modules", "prisma", "build", "index.js"), "migrate", "deploy"]);
run([path.join(root, "node_modules", "tsx", "dist", "cli.mjs"), "scripts/seed-e2e.ts"]);

const app = spawn(process.execPath, ["dist/src/index.js"], { cwd: server, env, stdio: "inherit" });
const stop = () => app.kill();
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
process.on("exit", stop);
app.on("exit", (code) => process.exit(code ?? 0));
