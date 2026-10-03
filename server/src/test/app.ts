import { pino } from "pino";
import { createApp } from "../app.js";
import { loadConfig } from "../core/config.js";
import type { AppDeps } from "../core/context.js";
import { createPrisma, type Db } from "../core/db.js";
import { testDatabaseUrl } from "./env.js";

export const TEST_BCRYPT_COST = 4;

let sharedDb: Db | undefined;

/** One Prisma client per test file (vitest isolates files). */
export function testDb(): Db {
  sharedDb ??= createPrisma(testDatabaseUrl());
  return sharedDb;
}

/** A controllable clock: tests move time instead of sleeping or editing timestamps. */
export class TestClock {
  private fixed: Date | null = null;
  now = (): Date => this.fixed ?? new Date();
  set(date: Date | string) {
    this.fixed = new Date(date);
  }
  advance(minutes: number) {
    this.fixed = new Date(this.now().getTime() + minutes * 60_000);
  }
  reset() {
    this.fixed = null;
  }
}

export function createTestApp(clock = new TestClock(), env: Record<string, string> = {}) {
  const db = testDb();
  const config = loadConfig({
    NODE_ENV: "test",
    DATABASE_URL: testDatabaseUrl(),
    COOKIE_SECURE: "false",
    BCRYPT_COST: String(TEST_BCRYPT_COST),
    LOG_LEVEL: "silent",
    // High enough that suites never trip it; the rate-limit test passes the production value.
    LOGIN_RATE_LIMIT: "10000",
    ...env,
  });
  const deps: AppDeps = { config, db, logger: pino({ level: "silent" }), clock: clock.now };
  return { app: createApp(deps), db, clock, deps };
}

/** Empties every table (TRUNCATE also bypasses the audit log's row-level append-only trigger). */
export async function resetDb(db: Db = testDb()): Promise<void> {
  const rows = await db.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (rows.length === 0) return;
  const tables = rows.map((r) => `"${r.tablename}"`).join(", ");
  await db.$executeRawUnsafe(`TRUNCATE ${tables} RESTART IDENTITY CASCADE`);
}
