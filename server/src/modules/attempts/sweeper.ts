import type { Logger } from "pino";
import type { Db } from "../../core/db.js";
import { GRACE_MS, HEARTBEAT_GAP_MS } from "./rules.js";
import { finalize } from "./service.js";

// Background work of the exam session (NEXT_PLAN §3.3): finalizes attempts whose time is over and
// marks students who stopped sending heartbeats. A transaction-scoped advisory lock means only one
// app instance sweeps at a time, so a second container never finalizes twice.
const SWEEP_LOCK = 784_312;

export async function sweep(db: Db, now: Date): Promise<{ finalized: number; disconnected: number }> {
  return db.$transaction(
    async (tx) => {
      const [lock] = await tx.$queryRaw<
        { locked: boolean }[]
      >`SELECT pg_try_advisory_xact_lock(${SWEEP_LOCK}) AS locked`;
      if (!lock?.locked) return { finalized: 0, disconnected: 0 };

      const overdue = await tx.attempt.findMany({
        where: { status: "IN_PROGRESS", deadlineAt: { lt: new Date(now.getTime() - GRACE_MS) } },
        select: { id: true },
      });
      let finalized = 0;
      for (const a of overdue) if (await finalize(tx, a.id, "AUTO_SUBMITTED", "time", now, null)) finalized++;

      // A heartbeat gap is logged once (not a strike: the proctor sees "disconnected").
      const silent = await tx.attempt.findMany({
        where: { status: "IN_PROGRESS", lastHeartbeatAt: { lt: new Date(now.getTime() - HEARTBEAT_GAP_MS) } },
        select: { id: true, lastHeartbeatAt: true },
      });
      let disconnected = 0;
      for (const a of silent) {
        const logged = await tx.violation.count({
          where: { attemptId: a.id, type: "HEARTBEAT_MISSED", occurredAt: { gte: a.lastHeartbeatAt ?? now } },
        });
        if (logged) continue;
        await tx.violation.create({
          data: {
            attemptId: a.id,
            type: "HEARTBEAT_MISSED",
            countsAsStrike: false,
            detail: { lastHeartbeatAt: a.lastHeartbeatAt?.toISOString() ?? null },
            occurredAt: now,
          },
        });
        disconnected++;
      }
      return { finalized, disconnected };
    },
    { timeout: 30_000 },
  );
}

/** Sweeps every 15 s until stopped. Errors are logged, never thrown (the next run retries). */
export function startSweeper(db: Db, logger: Logger, clock: () => Date, everyMs = 15_000): () => void {
  const timer = setInterval(() => {
    sweep(db, clock())
      .then((r) => {
        if (r.finalized || r.disconnected) logger.info(r, "exam session sweep");
      })
      .catch((err: unknown) => {
        logger.error({ err }, "exam session sweep failed");
      });
  }, everyMs);
  timer.unref();
  return () => {
    clearInterval(timer);
  };
}
