// Seeds the browser integration test database with WORLD (e2e-world.ts).
// Refuses any database whose name doesn't end in "_e2e", so it can never touch dev or production data.
import { loadConfig } from "../src/core/config.js";
import { createPrisma } from "../src/core/db.js";
import { slugify } from "../src/core/lib/slug.js";
import type { Permission } from "../src/generated/prisma/client.js";
import { hashPassword } from "../src/modules/auth/password.js";
import { E2E_PASSWORD, WORLD } from "./e2e-world.js";

const config = loadConfig();
const dbName = new URL(config.DATABASE_URL).pathname.slice(1);
if (!dbName.endsWith("_e2e")) {
  console.error(`seed-e2e: refusing to seed "${dbName}" (the name must end in _e2e).`);
  process.exit(1);
}

const prisma = createPrisma(config.DATABASE_URL);
const passwordHash = await hashPassword(E2E_PASSWORD, config.BCRYPT_COST);

const userIds: Record<string, string> = {};
for (const [key, u] of Object.entries(WORLD.users)) {
  const row = await prisma.user.create({
    data: {
      username: u.username,
      fullName: u.fullName,
      role: u.role,
      passwordHash,
      mustChangePassword: false,
    },
  });
  userIds[key] = row.id;
}

const groupIds: Record<string, string> = {};
for (const [key, g] of Object.entries(WORLD.groups)) {
  const row = await prisma.group.create({
    data: {
      name: g.name,
      intakeStartDate: new Date(`${g.intakeStartDate}T00:00:00Z`),
      members: { create: g.members.map((m) => ({ userId: userIds[m] ?? "" })) },
    },
  });
  groupIds[key] = row.id;
}

const categoryIds: Record<string, string> = {};
for (const [key, c] of Object.entries(WORLD.categories)) {
  const row = await prisma.category.create({ data: { name: c.name, slug: slugify(c.name) } });
  categoryIds[key] = row.id;
}

for (const e of Object.values(WORLD.exams)) {
  await prisma.exam.create({
    data: {
      code: e.code,
      title: e.title,
      categoryId: categoryIds[e.category] ?? "",
      durationMinutes: 45,
      status: "PUBLISHED",
      // Published exams have at least one valid question (the publish check).
      questions: {
        create: {
          type: "SINGLE_CHOICE",
          text: `Sample question of ${e.title}`,
          position: 0,
          options: {
            create: [
              { text: "Right", isCorrect: true, position: 0 },
              { text: "Wrong", isCorrect: false, position: 1 },
            ],
          },
        },
      },
    },
  });
}

for (const [key, g] of Object.entries(WORLD.grants)) {
  await prisma.instructorGrant.create({
    data: {
      userId: userIds[key] ?? "",
      permissions: [...g.permissions] as Permission[],
      categories: { create: g.categories.map((c) => ({ categoryId: categoryIds[c] ?? "" })) },
      groups: { create: g.groups.map((x) => ({ groupId: groupIds[x] ?? "" })) },
    },
  });
}

await prisma.$disconnect();
console.log(`seed-e2e: seeded ${dbName}.`);
