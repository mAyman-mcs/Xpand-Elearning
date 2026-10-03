import { execFileSync } from "node:child_process";
import path from "node:path";
import { testDatabaseUrl } from "./env.js";

/** Applies all migrations to the test database once before the integration suite. */
export default function setup() {
  const url = testDatabaseUrl();
  const prismaBin = path.resolve(import.meta.dirname, "../../../node_modules/prisma/build/index.js");
  execFileSync(process.execPath, [prismaBin, "migrate", "deploy"], {
    cwd: path.resolve(import.meta.dirname, "../.."),
    env: { ...process.env, DATABASE_URL: url },
    stdio: "pipe",
  });
  process.env.TEST_DATABASE_URL = url;
}
