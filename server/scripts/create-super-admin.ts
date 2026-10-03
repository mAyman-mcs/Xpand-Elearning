// Bootstraps (or resets) a super admin with a one-time temporary password.
//   npm run create-super-admin -w server -- --username amr.faisal --name "Amr Faisal" [--email ...]
// Inside the container:
//   docker compose exec app node dist/scripts/create-super-admin.js --username ... --name ...
import { parseArgs } from "node:util";
import { audit } from "../src/core/audit.js";
import { loadConfig } from "../src/core/config.js";
import { createPrisma } from "../src/core/db.js";
import { tempPassword } from "../src/core/lib/tokens.js";
import { hashPassword } from "../src/modules/auth/password.js";
import { revokeAllSessions } from "../src/modules/auth/session.js";

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

const config = loadConfig();
const prisma = createPrisma(config.DATABASE_URL);
const username = values.username.trim().toLowerCase();
const password = tempPassword(16);
const passwordHash = await hashPassword(password, config.BCRYPT_COST);

const user = await prisma.user.upsert({
  where: { username },
  create: { username, fullName: values.name, email: values.email, role: "SUPER_ADMIN", passwordHash },
  update: {
    role: "SUPER_ADMIN",
    passwordHash,
    mustChangePassword: true,
    isActive: true,
    failedLogins: 0,
    lockedUntil: null,
  },
});
await revokeAllSessions(prisma, user.id, new Date());
await audit(prisma, {
  action: "admin.super_admin_bootstrap",
  actorId: null,
  entityType: "User",
  entityId: user.id,
  detail: { username },
});

console.log(`Super admin "${username}" ready. Temporary password (shown once, must be changed at first login):`);
console.log(password);
await prisma.$disconnect();
