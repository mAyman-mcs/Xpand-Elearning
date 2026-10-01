import type { Request } from "express";
import { prisma } from "./db.js";
import type { Prisma } from "./generated/prisma/client.js";

interface AuditEntry {
  action: string;
  actorId?: string | null;
  entityType?: string;
  entityId?: string;
  detail?: Prisma.InputJsonValue;
}

/** Appends to the audit log. Never throws: a logging failure must not break the action itself. */
export async function audit(req: Request | null, entry: AuditEntry): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        action: entry.action,
        actorId: entry.actorId ?? req?.auth?.user.id ?? null,
        entityType: entry.entityType,
        entityId: entry.entityId,
        detail: entry.detail,
        ip: req?.ip,
      },
    });
  } catch (err) {
    console.error("audit log write failed", entry.action, err);
  }
}
