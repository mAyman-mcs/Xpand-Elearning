// Imports students from a CSV and issues temporary passwords. The same rules as the admin screen
// (src/modules/users/import.ts): every row is checked first, then everything is created in one
// transaction, or nothing at all.
//   npm run import-users -w server -- --file ../imports/students.csv [--out ../imports] [--dry-run]
//
// CSV columns (header row required):
//   username, fullName, email, mobile, group, groupIntakeDate (YYYY-MM-DD), joinDate (YYYY-MM-DD)
// Only username and fullName are required. A group that doesn't exist yet is created with its
// groupIntakeDate. Usernames that already exist are reported as errors (nothing is overwritten).
//
// Credentials are written to <out>/credentials-<timestamp>.csv: hand them out, then delete the file.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import pino from "pino";
import { loadConfig } from "../src/core/config.js";
import { createPrisma } from "../src/core/db.js";
import { AppError } from "../src/core/errors.js";
import { parseCsv, toCsv } from "../src/core/lib/csv.js";
import { importUsers, MAX_IMPORT_ROWS, type ImportError } from "../src/modules/users/import.js";

const { values } = parseArgs({
  options: {
    file: { type: "string" },
    out: { type: "string", default: "../imports" },
    "dry-run": { type: "boolean", default: false },
  },
});
if (!values.file) {
  console.error("Usage: import-users --file <students.csv> [--out <dir>] [--dry-run]");
  process.exit(1);
}

const config = loadConfig();
const prisma = createPrisma(config.DATABASE_URL);
const ctx = { db: prisma, now: new Date(), actor: null, logger: pino({ level: "silent" }) };

const rows = parseCsv(readFileSync(values.file, "utf8"));
if (rows.length > MAX_IMPORT_ROWS) {
  console.error(`The file has ${rows.length} rows; import at most ${MAX_IMPORT_ROWS} at a time.`);
  process.exit(1);
}

const printErrors = (errors: { row: number; field: string; message: string }[]) => {
  // CSV line = data row + 1 (the header is line 1).
  for (const e of errors) console.error(`line ${e.row + 1}: ${e.field}: ${e.message}`);
  console.error("No users imported; fix the rows above and retry.");
};

try {
  const result = await importUsers(ctx, config.BCRYPT_COST, { rows, dryRun: values["dry-run"] }, "script");
  if (result.errors.length) {
    printErrors(result.errors);
    process.exitCode = 1;
  } else if (result.dryRun) {
    console.log(
      `Dry run: ${result.summary.users} user(s) would be created; new groups: ${result.summary.newGroups.join(", ") || "none"}.`,
    );
  } else {
    mkdirSync(values.out, { recursive: true });
    const outFile = path.join(values.out, `credentials-${new Date().toISOString().replace(/[:.]/g, "-")}.csv`);
    writeFileSync(outFile, toCsv(result.created), { mode: 0o600 });
    console.log(`Imported ${result.created.length} user(s). Credentials: ${outFile}`);
  }
} catch (err) {
  if (err instanceof AppError && err.code === "VALIDATION_FAILED") {
    printErrors(
      (err.options.details as (ImportError & { path: string })[]).map(({ row, path: p, message }) => ({
        row,
        field: p.split(".").slice(2).join("."),
        message,
      })),
    );
    process.exitCode = 1;
  } else throw err;
} finally {
  await prisma.$disconnect();
}
