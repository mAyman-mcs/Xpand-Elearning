import { z } from "zod";

const bool = z.enum(["true", "false"]).transform((v) => v === "true");

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(8080),
  DATABASE_URL: z.string().min(1),
  TRUST_PROXY: z.coerce.number().int().min(0).default(0),
  COOKIE_SECURE: bool.default(true),
  SESSION_IDLE_MINUTES: z.coerce.number().int().positive().default(20),
  SESSION_MAX_HOURS: z.coerce.number().int().positive().default(12),
  // Directory holding the built React app; served only when it exists.
  WEB_DIST: z.string().optional(),
});

export type Config = z.infer<typeof schema>;

export const config: Config = schema.parse(process.env);
