// Imports students from a CSV and issues temporary passwords.
//   npm run import-users -w server -- --file ../imports/students.csv [--out ../imports]
//
// CSV columns (header row required):
//   username, fullName, email, mobile, group, groupIntakeDate (YYYY-MM-DD), joinDate (optional, YYYY-MM-DD)
//
// - Groups are created on first sight using groupIntakeDate.
// - Existing usernames are skipped, never overwritten.
// - Credentials are written to <out>/credentials-<timestamp>.csv — hand them out, then delete the file.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";
import { hashPassword } from "../src/auth/password.js";
import { prisma } from "../src/db.js";
import { parseCsv, toCsv } from "../src/lib/csv.js";
import { tempPassword } from "../src/lib/tokens.js";

const { values } = parseArgs({
  options: { file: { type: "string" }, out: { type: "string", default: "../imports" } },
});
if (!values.file) {
  console.error("Usage: import-users --file <students.csv> [--out <dir>]");
  process.exit(1);
}

const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .transform((s) => new Date(`${s}T00:00:00Z`));

const rowSchema = z.object({
  username: z.string().trim().toLowerCase().regex(/^[a-z0-9._-]{3,50}$/, "3-50 chars: a-z 0-9 . _ -"),
  fullName: z.string().trim().min(1),
  email: z.union([z.literal(""), z.email()]).transform((v) => v || null),
  mobile: z.string().trim().transform((v) => v || null),
  group: z.string().trim().min(1),
  groupIntakeDate: date,
  joinDate: z.union([z.literal(""), date]).transform((v) => (v === "" ? null : v)),
});

const rows = parseCsv(readFileSync(values.file, "utf8"));
const parsed = rows.map((r, i) => ({ line: i + 2, result: rowSchema.safeParse(r) }));
const invalid = parsed.filter((p) => !p.result.success);
if (invalid.length > 0) {
  for (const p of invalid) console.error(`line ${p.line}: ${p.result.error!.issues.map((x) => `${x.path.join(".")}: ${x.message}`).join("; ")}`);
  console.error("No users imported; fix the rows above and retry.");
  process.exit(1);
}

const credentials: Record<string, string>[] = [];
let skipped = 0;

for (const { result } of parsed) {
  const r = result.data!;
  const group = await prisma.group.upsert({
    where: { name: r.group },
    create: { name: r.group, intakeStartDate: r.groupIntakeDate },
    update: {},
  });

  if (await prisma.user.findUnique({ where: { username: r.username } })) {
    console.warn(`skip: username "${r.username}" already exists`);
    skipped++;
    continue;
  }

  const password = tempPassword();
  const user = await prisma.user.create({
    data: {
      username: r.username,
      fullName: r.fullName,
      email: r.email,
      mobile: r.mobile,
      role: "STUDENT",
      passwordHash: await hashPassword(password),
      joinDate: r.joinDate,
      memberships: { create: { groupId: group.id, joinDate: r.joinDate } },
    },
  });
  await prisma.auditLog.create({
    data: { action: "admin.user_imported", entityType: "User", entityId: user.id, detail: { username: r.username, group: r.group } },
  });
  credentials.push({ username: r.username, fullName: r.fullName, email: r.email ?? "", temporaryPassword: password });
}

if (credentials.length > 0) {
  mkdirSync(values.out!, { recursive: true });
  const outFile = path.join(values.out!, `credentials-${new Date().toISOString().replace(/[:.]/g, "-")}.csv`);
  writeFileSync(outFile, toCsv(credentials), { mode: 0o600 });
  console.log(`Imported ${credentials.length} user(s), skipped ${skipped}. Credentials: ${outFile}`);
} else {
  console.log(`Nothing imported (skipped ${skipped}).`);
}
await prisma.$disconnect();
