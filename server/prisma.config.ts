import { existsSync } from "node:fs";
import { defineConfig } from "prisma/config";

// Local dev keeps DATABASE_URL in the repo-root .env; in Docker it comes from the environment.
if (!process.env.DATABASE_URL && existsSync("../.env")) process.loadEnvFile("../.env");

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: { url: process.env.DATABASE_URL },
});
