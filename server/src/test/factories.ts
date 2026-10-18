import bcrypt from "bcryptjs";
import type { DbClient } from "../core/db.js";
import { slugify } from "../core/lib/slug.js";
import type { Category, Exam, Group, Permission, Role, Tag, User } from "../generated/prisma/client.js";
import { TEST_BCRYPT_COST } from "./app.js";

export const TEST_PASSWORD = "Test-pass-123";

let seq = 0;
const next = () => ++seq;

// Hashing once keeps factories fast; every test user shares this password unless overridden.
const defaultHash = bcrypt.hashSync(TEST_PASSWORD, TEST_BCRYPT_COST);

export interface TestUser extends User {
  password: string;
}

export async function makeUser(
  db: DbClient,
  opts: {
    role?: Role;
    username?: string;
    password?: string;
    mustChangePassword?: boolean;
    isActive?: boolean;
    joinDate?: Date;
    groups?: (Group | { group: Group; joinDate?: Date })[];
  } = {},
): Promise<TestUser> {
  const n = next();
  const password = opts.password ?? TEST_PASSWORD;
  const user = await db.user.create({
    data: {
      username: opts.username ?? `user${n}`,
      fullName: `Test User ${n}`,
      role: opts.role ?? "STUDENT",
      passwordHash: opts.password ? bcrypt.hashSync(password, TEST_BCRYPT_COST) : defaultHash,
      mustChangePassword: opts.mustChangePassword ?? false,
      isActive: opts.isActive ?? true,
      joinDate: opts.joinDate,
      memberships: {
        create: (opts.groups ?? []).map((g) =>
          "group" in g ? { groupId: g.group.id, joinDate: g.joinDate } : { groupId: g.id },
        ),
      },
    },
  });
  return { ...user, password };
}

export function makeGroup(db: DbClient, opts: { name?: string; intakeStartDate?: Date } = {}): Promise<Group> {
  return db.group.create({
    data: {
      name: opts.name ?? `Group ${next()}`,
      intakeStartDate: opts.intakeStartDate ?? new Date("2026-07-05T00:00:00Z"),
    },
  });
}

export function makeGrant(
  db: DbClient,
  user: Pick<User, "id">,
  opts: {
    permissions: Permission[];
    examIds?: string[];
    categoryIds?: string[];
    tagIds?: string[];
    groupIds?: string[];
    allExams?: boolean;
    allGroups?: boolean;
    studentsWhoSubmitted?: boolean;
    expiresAt?: Date | null;
  },
) {
  return db.instructorGrant.create({
    data: {
      userId: user.id,
      permissions: opts.permissions,
      allExams: opts.allExams ?? false,
      allGroups: opts.allGroups ?? false,
      studentsWhoSubmitted: opts.studentsWhoSubmitted ?? false,
      expiresAt: opts.expiresAt ?? null,
      exams: { create: (opts.examIds ?? []).map((examId) => ({ examId })) },
      categories: { create: (opts.categoryIds ?? []).map((categoryId) => ({ categoryId })) },
      tags: { create: (opts.tagIds ?? []).map((tagId) => ({ tagId })) },
      groups: { create: (opts.groupIds ?? []).map((groupId) => ({ groupId })) },
    },
  });
}

export function makeCategory(db: DbClient, opts: { name?: string; archived?: boolean } = {}): Promise<Category> {
  const n = next();
  const name = opts.name ?? `Category ${n}`;
  return db.category.create({
    data: { name, slug: slugify(name), archived: opts.archived },
  });
}

export function makeTag(db: DbClient, opts: { name?: string } = {}): Promise<Tag> {
  const name = opts.name ?? `tag ${next()}`;
  return db.tag.create({ data: { name, slug: slugify(name) } });
}

export function makeExam(
  db: DbClient,
  category: Pick<Category, "id">,
  opts: { title?: string; status?: Exam["status"]; tags?: Tag[]; isExternal?: boolean } = {},
): Promise<Exam> {
  const n = next();
  return db.exam.create({
    data: {
      code: `EXAM-${n}`,
      title: opts.title ?? `Exam ${n}`,
      categoryId: category.id,
      durationMinutes: 30,
      // Published by default: most tests are about exams students can see.
      status: opts.status ?? "PUBLISHED",
      isExternal: opts.isExternal,
      tags: { create: (opts.tags ?? []).map((t) => ({ tagId: t.id })) },
    },
  });
}
