import { existsSync } from "node:fs";
import path from "node:path";

/**
 * The integration-test database URL: TEST_DATABASE_URL, or the dev DATABASE_URL from the repo-root
 * .env with the database renamed to xpand_test. Refuses anything not ending in "_test", so tests
 * can never wipe a dev or production database.
 */
export function testDatabaseUrl(): string {
  let url = process.env.TEST_DATABASE_URL;
  if (!url) {
    const envFile = path.resolve(import.meta.dirname, "../../../.env");
    if (!process.env.DATABASE_URL && existsSync(envFile)) process.loadEnvFile(envFile);
    if (!process.env.DATABASE_URL)
      throw new Error("Set TEST_DATABASE_URL (or DATABASE_URL in .env) for integration tests");
    const derived = new URL(process.env.DATABASE_URL);
    derived.pathname = "/xpand_test";
    url = derived.toString();
  }
  const dbName = new URL(url).pathname.slice(1);
  if (!dbName.endsWith("_test")) {
    throw new Error(`Refusing to run integration tests against database "${dbName}" (name must end in _test)`);
  }
  return url;
}
