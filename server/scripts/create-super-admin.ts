// Bootstraps (or resets) a super admin with a one-time temporary password.
//   npm run create-super-admin -w server -- --username amr.faisal --name "Amr Faisal" [--email ...]
// Inside the container:
//   docker compose exec app npx tsx scripts/create-super-admin.ts --username ... --name ...
import { parseArgs } from "node:util";
import { hashPassword } from "../src/auth/password.js";
import { revokeAllSessions } from "../src/auth/session.js";
import { prisma } from "../src/db.js";
import { tempPassword } from "../src/lib/tokens.js";

const { values } = parseArgs({
  options: {
    username: { type: "string" },
    name: { type: "string" },
    email: { type: "string" },
  },
});

if (!values.username || !values.name) {
  console.error('Usage: create-super-admin --username <u> --name "<full name>" [--email <e>]');
  process.exit(1);
}

const username = values.username.trim().toLowerCase();
const password = tempPassword(16);
const passwordHash = await hashPassword(password);

const user = await prisma.user.upsert({
  where: { username },
  create: { username, fullName: values.name, email: values.email, role: "SUPER_ADMIN", passwordHash },
  update: { role: "SUPER_ADMIN", passwordHash, mustChangePassword: true, isActive: true, failedLogins: 0, lockedUntil: null },
});
await revokeAllSessions(user.id);
await prisma.auditLog.create({
  data: { action: "admin.super_admin_bootstrap", entityType: "User", entityId: user.id, detail: { username } },
});

console.log(`Super admin "${username}" ready. Temporary password (shown once, must be changed at first login):`);
console.log(password);
await prisma.$disconnect();
