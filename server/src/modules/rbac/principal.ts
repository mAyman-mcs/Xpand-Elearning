import type { DbClient } from "../../core/db.js";
import type { User } from "../../generated/prisma/client.js";
import type { Principal } from "./authorize.js";

/** Loads the caller's role and grants. Only instructors have grants, so others cost no query. */
export async function loadPrincipal(db: DbClient, user: Pick<User, "id" | "role">): Promise<Principal> {
  if (user.role !== "INSTRUCTOR") return { userId: user.id, role: user.role, grants: [] };

  const grants = await db.instructorGrant.findMany({
    where: { userId: user.id },
    include: {
      exams: { select: { examId: true } },
      categories: { select: { categoryId: true } },
      tags: { select: { tagId: true } },
      groups: { select: { groupId: true } },
    },
  });
  return {
    userId: user.id,
    role: user.role,
    grants: grants.map((g) => ({
      permissions: g.permissions,
      allExams: g.allExams,
      examIds: g.exams.map((e) => e.examId),
      categoryIds: g.categories.map((c) => c.categoryId),
      tagIds: g.tags.map((t) => t.tagId),
      allGroups: g.allGroups,
      groupIds: g.groups.map((x) => x.groupId),
      studentsWhoSubmitted: g.studentsWhoSubmitted,
      expiresAt: g.expiresAt,
    })),
  };
}
