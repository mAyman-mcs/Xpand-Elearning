import { z } from "zod";

const bool = z.enum(["true", "false"]).transform((v) => v === "true");

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(8080),
  DATABASE_URL: z.string().min(1),
  // Database connections per app container (Postgres allows 100 by default).
  DB_POOL_MAX: z.coerce.number().int().min(2).max(90).default(20),
  TRUST_PROXY: z.coerce.number().int().min(0).default(0),
  COOKIE_SECURE: bool.default(true),
  SESSION_IDLE_MINUTES: z.coerce.number().int().positive().default(20),
  SESSION_MAX_HOURS: z.coerce.number().int().positive().default(12),
  // Login attempts per IP per 15 minutes.
  LOGIN_RATE_LIMIT: z.coerce.number().int().positive().default(20),
  // 12 in production; tests lower it to keep suites fast.
  BCRYPT_COST: z.coerce.number().int().min(4).max(15).default(12),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  // Directory holding the built React app; served only when it exists.
  WEB_DIST: z.string().optional(),
});

export type Config = z.infer<typeof schema>;

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  return schema.parse(env);
}
