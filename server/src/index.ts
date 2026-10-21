import { createApp } from "./app.js";
import { loadConfig } from "./core/config.js";
import { createPrisma } from "./core/db.js";
import { createLogger } from "./core/logger.js";
import { startSweeper } from "./modules/attempts/sweeper.js";

const config = loadConfig();
const logger = createLogger(config);
const db = createPrisma(config.DATABASE_URL, config.DB_POOL_MAX);

const clock = () => new Date();
const stopSweeper = startSweeper(db, logger, clock);
const server = createApp({ config, db, logger, clock }).listen(config.PORT, () => {
  logger.info({ port: config.PORT, env: config.NODE_ENV }, "xpand portal listening");
});

function shutdown(signal: string) {
  logger.info({ signal }, "shutting down");
  stopSweeper();
  server.close(() => {
    void db.$disconnect().finally(() => process.exit(0));
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGTERM", () => {
  shutdown("SIGTERM");
});
process.on("SIGINT", () => {
  shutdown("SIGINT");
});
