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
import { audit } from "../src/core/audit.js";
import { loadConfig } from "../src/core/config.js";
import { createPrisma } from "../src/core/db.js";
import { parseCsv, toCsv } from "../src/core/lib/csv.js";
import { tempPassword } from "../src/core/lib/tokens.js";
import { hashPassword } from "../src/modules/auth/password.js";

const { values } = parseArgs({
  options: { file: { type: "string" }, out: { type: "string", default: "../imports" } },
});
if (!values.file) {
  console.error("Usage: import-users --file <students.csv> [--out <dir>]");
  process.exit(1);
}

const config = loadConfig();
const prisma = createPrisma(config.DATABASE_URL);

const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .transform((s) => new Date(`${s}T00:00:00Z`));

const rowSchema = z.object({
  username: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9._-]{3,50}$/, "3-50 chars: a-z 0-9 . _ -"),
  fullName: z.string().trim().min(1),
  email: z.union([z.literal(""), z.email()]).transform((v) => v || null),
  mobile: z
    .string()
    .trim()
    .transform((v) => v || null),
  group: z.string().trim().min(1),
  groupIntakeDate: date,
  joinDate: z.union([z.literal(""), date]).transform((v) => (v === "" ? null : v)),
});

const rows = parseCsv(readFileSync(values.file, "utf8"));
const validRows: z.infer<typeof rowSchema>[] = [];
const errors: string[] = [];
rows.forEach((row, i) => {
  const result = rowSchema.safeParse(row);
  if (result.success) validRows.push(result.data);
  else errors.push(`line ${i + 2}: ${result.error.issues.map((x) => `${x.path.join(".")}: ${x.message}`).join("; ")}`);
});
if (errors.length > 0) {
  for (const e of errors) console.error(e);
  console.error("No users imported; fix the rows above and retry.");
  process.exit(1);
}

const credentials: Record<string, string>[] = [];
let skipped = 0;

for (const r of validRows) {
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
      passwordHash: await hashPassword(password, config.BCRYPT_COST),
      joinDate: r.joinDate,
      memberships: { create: { groupId: group.id, joinDate: r.joinDate } },
    },
  });
  await audit(prisma, {
    action: "admin.user_imported",
    actorId: null,
    entityType: "User",
    entityId: user.id,
    detail: { username: r.username, group: r.group },
  });
  credentials.push({ username: r.username, fullName: r.fullName, email: r.email ?? "", temporaryPassword: password });
}

const outDir = values.out;
if (credentials.length > 0) {
  mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `credentials-${new Date().toISOString().replace(/[:.]/g, "-")}.csv`);
  writeFileSync(outFile, toCsv(credentials), { mode: 0o600 });
  console.log(`Imported ${credentials.length} user(s), skipped ${skipped}. Credentials: ${outFile}`);
} else {
  console.log(`Nothing imported (skipped ${skipped}).`);
}
await prisma.$disconnect();
