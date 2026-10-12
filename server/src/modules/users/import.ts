import { z } from "zod";
import { audit } from "../../core/audit.js";
import type { Ctx } from "../../core/context.js";
import { inTransaction } from "../../core/db.js";
import { AppError } from "../../core/errors.js";
import { tempPassword } from "../../core/lib/tokens.js";
import { hashPassword } from "../auth/password.js";

// Importing students from a CSV, shared by POST /api/users/import (the admin screen) and the
// import-users script, so both behave the same (docs/ADMIN_DASHBOARD_PLAN.md BE-3):
// validate every row, then create everything in one transaction or nothing at all.
//
// Columns: username, fullName, email, mobile, group, groupIntakeDate, joinDate. Empty = not given.

/** Each row costs one bcrypt hash (~0.25 s at the production cost): keep requests under a minute. */
export const MAX_IMPORT_ROWS = 200;

const blankToUndefined = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);
const ymd = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
const optional = <T extends z.ZodType>(schema: T) => z.preprocess(blankToUndefined, schema.optional());

export const importRowSchema = z.object({
  username: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9._-]{3,50}$/, "3-50 characters: a-z 0-9 . _ -"),
  fullName: z.string().trim().min(1, "Required").max(200),
  email: optional(z.email("Not a valid email")),
  mobile: optional(z.string().trim().max(30)),
  group: optional(z.string().trim().max(100)),
  groupIntakeDate: optional(ymd),
  joinDate: optional(ymd),
});
type ImportRow = z.infer<typeof importRowSchema>;

export const importBody = z.object({
  rows: z.array(z.record(z.string(), z.string())).min(1, "The file has no rows").max(MAX_IMPORT_ROWS),
  dryRun: z.boolean().default(true),
});

export interface ImportError {
  /** 1-based data row (the CSV line is row + 1, after the header). */
  row: number;
  field: string;
  message: string;
}

// A type alias (not an interface) so it also fits Record<string, string> for the CSV writer.
type Created = { username: string; fullName: string; temporaryPassword: string };
const NONE_CREATED: Created[] = [];
const NO_ERRORS: ImportError[] = [];

const date = (s: string) => new Date(`${s}T00:00:00Z`);

/** Validates every row against the schema, the file itself and the database. Writes nothing. */
async function check(ctx: Ctx, raw: Record<string, string>[]) {
  const errors: ImportError[] = [];
  const rows: ImportRow[] = [];
  raw.forEach((r, i) => {
    const parsed = importRowSchema.safeParse(r);
    if (parsed.success) rows.push(parsed.data);
    else
      for (const issue of parsed.error.issues)
        errors.push({ row: i + 1, field: issue.path.join("."), message: issue.message });
  });
  if (errors.length) return { errors, rows: [], newGroups: [], existingGroups: [] };

  const seen = new Map<string, number>();
  rows.forEach((r, i) => {
    const first = seen.get(r.username);
    if (first !== undefined) errors.push({ row: i + 1, field: "username", message: `Same username as row ${first}` });
    else seen.set(r.username, i + 1);
  });

  const taken = await ctx.db.user.findMany({
    where: { username: { in: [...seen.keys()] } },
    select: { username: true },
  });
  for (const t of taken)
    errors.push({ row: seen.get(t.username) ?? 0, field: "username", message: "This username already exists" });

  const groupNames = [...new Set(rows.flatMap((r) => (r.group ? [r.group] : [])))];
  const existing = await ctx.db.group.findMany({ where: { name: { in: groupNames } }, select: { name: true } });
  const existingGroups = new Set(existing.map((g) => g.name));
  const newGroups = groupNames.filter((g) => !existingGroups.has(g));
  rows.forEach((r, i) => {
    if (r.group && !existingGroups.has(r.group) && !r.groupIntakeDate)
      errors.push({
        row: i + 1,
        field: "groupIntakeDate",
        message: `"${r.group}" is a new group: give its intake date`,
      });
  });
  // A new group's intake date must agree across its rows.
  for (const g of newGroups) {
    const dates = new Set(rows.filter((r) => r.group === g && r.groupIntakeDate).map((r) => r.groupIntakeDate));
    if (dates.size > 1) {
      const row = rows.findIndex((r) => r.group === g) + 1;
      errors.push({ row, field: "groupIntakeDate", message: `Rows give different intake dates for "${g}"` });
    }
  }
  errors.sort((a, b) => a.row - b.row);
  return { errors, rows, newGroups, existingGroups: [...existingGroups] };
}

/**
 * Dry run: the problems and what would be created. Real run: creates every user (and new groups)
 * and returns each temporary password once, or creates nothing and answers 400 with the problems.
 */
export async function importUsers(
  ctx: Ctx,
  bcryptCost: number,
  input: { rows: Record<string, string>[]; dryRun: boolean },
  source: "screen" | "script",
) {
  const { errors, rows, newGroups, existingGroups } = await check(ctx, input.rows);
  const summary = { users: rows.length, newGroups, existingGroups };
  if (input.dryRun) return { dryRun: true, errors, summary, created: NONE_CREATED };
  if (errors.length)
    throw new AppError("VALIDATION_FAILED", {
      message: "The file has problems; nothing was imported.",
      details: errors.map((e) => ({ path: `rows.${e.row}.${e.field}`, message: e.message, row: e.row })),
    });

  // Hash outside the transaction: it is slow, and must not hold database locks.
  const withPasswords = await Promise.all(
    rows.map(async (r) => {
      const password = tempPassword();
      return { ...r, password, passwordHash: await hashPassword(password, bcryptCost) };
    }),
  );
  const actorId = ctx.actor?.userId ?? null;

  const created = await inTransaction(
    ctx.db,
    async (tx) => {
      const groupIds = new Map<string, string>();
      for (const g of await tx.group.findMany({ where: { name: { in: existingGroups } } })) groupIds.set(g.name, g.id);
      for (const name of newGroups) {
        const intake = rows.find((r) => r.group === name)?.groupIntakeDate ?? "";
        const g = await tx.group.create({ data: { name, intakeStartDate: date(intake) } });
        groupIds.set(name, g.id);
        await audit(tx, {
          action: "groups.created",
          actorId,
          entityType: "Group",
          entityId: g.id,
          detail: { name, intakeStartDate: intake, source },
          ip: ctx.ip,
        });
      }

      const out: Created[] = [];
      for (const r of withPasswords) {
        const joinDate = r.joinDate ? date(r.joinDate) : null;
        const groupId = r.group ? groupIds.get(r.group) : undefined;
        const user = await tx.user.create({
          data: {
            username: r.username,
            fullName: r.fullName,
            email: r.email ?? null,
            mobile: r.mobile ?? null,
            role: "STUDENT",
            passwordHash: r.passwordHash,
            mustChangePassword: true,
            joinDate,
            ...(groupId ? { memberships: { create: { groupId, joinDate } } } : {}),
          },
        });
        await audit(tx, {
          action: "users.created",
          actorId,
          entityType: "User",
          entityId: user.id,
          detail: { username: user.username, role: "STUDENT", groupIds: groupId ? [groupId] : [], source },
          ip: ctx.ip,
        });
        out.push({ username: r.username, fullName: r.fullName, temporaryPassword: r.password });
      }
      await audit(tx, {
        action: "users.imported",
        actorId,
        detail: { count: out.length, newGroups, source },
        ip: ctx.ip,
      });
      return out;
    },
    { timeoutMs: 60_000 },
  );
  return { dryRun: false, errors: NO_ERRORS, summary, created };
}
