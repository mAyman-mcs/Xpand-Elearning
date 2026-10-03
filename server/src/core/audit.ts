import type { Logger } from "pino";
import type { Prisma } from "../generated/prisma/client.js";
import type { DbClient } from "./db.js";

export interface AuditEntry {
  action: string; // "<module>.<verb>", e.g. "rbac.grant_created"
  actorId: string | null;
  entityType?: string;
  entityId?: string;
  detail?: Prisma.InputJsonValue;
  ip?: string;
}

/**
 * Writes an audit entry. Pass the transaction client so the entry commits or rolls back
 * together with the change it describes — staff actions must never happen unaudited.
 */
export async function audit(db: DbClient, entry: AuditEntry): Promise<void> {
  await db.auditLog.create({ data: entry });
}

/** For security events outside a transaction (logins): a logging failure must not block the user. */
export async function auditBestEffort(db: DbClient, logger: Logger, entry: AuditEntry): Promise<void> {
  try {
    await audit(db, entry);
  } catch (err) {
    logger.error({ err, action: entry.action }, "audit log write failed");
  }
}
