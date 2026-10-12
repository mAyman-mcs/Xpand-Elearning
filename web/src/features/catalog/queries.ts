import type { Exam } from "@contracts";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { qk } from "../../lib/query";

export function useCategories(includeArchived = false) {
  return useQuery({
    queryKey: [...qk.categories, { includeArchived }],
    queryFn: () => api.categories.list(includeArchived),
  });
}

export function useTags() {
  return useQuery({ queryKey: qk.tags, queryFn: api.tags.list });
}

/**
 * Every exam the caller can see, for pickers and name lookups. The academy has tens of exams, so
 * reading all pages is cheap; lists that can grow large use "Load more" instead.
 */
export function useAllExams() {
  return useQuery({
    queryKey: [...qk.exams, "all"],
    queryFn: async () => {
      const all: Exam[] = [];
      let cursor: string | undefined;
      for (let page = 0; page < 20; page++) {
        const res = await api.exams.list({}, cursor);
        all.push(...res.items);
        if (!res.nextCursor) break;
        cursor = res.nextCursor;
      }
      return all;
    },
  });
}
