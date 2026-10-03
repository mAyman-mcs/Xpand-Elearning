import { z } from "zod";

export const pageQuery = z.object({
  cursor: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type PageQuery = z.infer<typeof pageQuery>;

export interface Page<T> {
  items: T[];
  /** Pass as `cursor` to get the next page; null on the last page. */
  nextCursor: string | null;
}

/** Prisma arguments for one page: fetch one extra row to know whether another page exists. */
export function pageArgs(page: PageQuery) {
  return {
    take: page.limit + 1,
    ...(page.cursor ? { cursor: { id: page.cursor }, skip: 1 } : {}),
  };
}

export function toPage<T extends { id: string }, R>(rows: T[], page: PageQuery, map: (row: T) => R): Page<R> {
  const hasMore = rows.length > page.limit;
  const items = hasMore ? rows.slice(0, page.limit) : rows;
  return { items: items.map(map), nextCursor: hasMore ? (items.at(-1)?.id ?? null) : null };
}
