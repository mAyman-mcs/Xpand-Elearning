import { existsSync } from "node:fs";
import { defineConfig } from "vitest/config";

if (!process.env.DATABASE_URL && existsSync("../.env")) process.loadEnvFile("../.env");

// Integration tests hit the dev Postgres from docker-compose.dev.yml.
export default defineConfig({
  test: {
    include: ["src/**/*.int.test.ts"],
    env: { DATABASE_URL: process.env.DATABASE_URL ?? "", COOKIE_SECURE: "false", TRUST_PROXY: "0" },
    fileParallelism: false,
    testTimeout: 30_000,
  },
});
