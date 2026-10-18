import type { DbClient } from "../../core/db.js";
import { AppError } from "../../core/errors.js";
import type { Principal } from "../rbac/authorize.js";

// "Access tags": tags used by at least one instructor grant. Putting one on an exam (or taking it
// off) changes who can reach that exam and its students, so only super admins may do it, whatever
// other rights an instructor holds on the exam. Other tags stay free for instructors with EXAM_EDIT.

/** The names of the given tags that are access tags. */
export async function accessTagNames(db: DbClient, tagIds: string[]): Promise<string[]> {
  if (!tagIds.length) return [];
  const tags = await db.tag.findMany({
    where: { id: { in: tagIds }, grantScopes: { some: {} } },
    select: { name: true },
    orderBy: { name: "asc" },
  });
  return tags.map((t) => t.name);
}

/** Refuses an instructor adding or removing access tags (the tags given are the ones being changed). */
export async function assertMayChangeAccessTags(db: DbClient, actor: Principal, changedTagIds: string[]) {
  if (actor.role === "SUPER_ADMIN") return;
  const names = await accessTagNames(db, changedTagIds);
  if (names.length)
    throw new AppError("FORBIDDEN", {
      message: `Only a super admin can add or remove ${names.map((n) => `“${n}”`).join(", ")}: ${names.length === 1 ? "this tag gives" : "these tags give"} instructors access.`,
      details: { tags: names },
    });
}
