import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type Prisma } from "../generated/prisma/client.js";

export type Db = PrismaClient;
/** Either the root client or an interactive-transaction client. Services accept both. */
export type DbClient = PrismaClient | Prisma.TransactionClient;

/**
 * The pool is sized for an exam start, when a whole class saves, reports and heartbeats at once.
 * A transaction waits up to 10 s for a free connection (Prisma's default is 2 s), so a burst queues
 * instead of failing with a 500.
 */
export function createPrisma(databaseUrl: string, poolMax = 20): PrismaClient {
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl, max: poolMax }),
    transactionOptions: { maxWait: 10_000, timeout: 10_000 },
  });
}

/**
 * Runs `fn` in a transaction, or directly when `db` already is one (nested service calls, tests).
 * `timeoutMs` overrides Prisma's 5 s limit for the rare large batch (CSV import).
 */
export function inTransaction<T>(
  db: DbClient,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
  options?: { timeoutMs?: number },
): Promise<T> {
  if (!("$transaction" in db)) return fn(db);
  return options?.timeoutMs ? db.$transaction(fn, { timeout: options.timeoutMs }) : db.$transaction(fn);
}

/** True for a unique-constraint violation (Prisma P2002), e.g. a duplicate name. */
export function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && err.code === "P2002";
}
