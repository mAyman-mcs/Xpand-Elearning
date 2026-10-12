import { QueryClient } from "@tanstack/react-query";
import { ApiError } from "./api";

export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: false,
        // Retrying 4xx answers can't help (and 401 means the session is gone); retry network/5xx once.
        retry: (count, error) => !(error instanceof ApiError && error.status < 500) && count < 1,
      },
      mutations: { retry: false },
    },
  });
}

/** Query keys in one place, so a change can refetch everything that depends on it. */
export const qk = {
  permissions: ["me", "permissions"] as const,
  users: ["users"] as const,
  user: (id: string) => ["users", id] as const,
  groups: ["groups"] as const,
  group: (id: string) => ["groups", id] as const,
  grants: ["grants"] as const,
  categories: ["categories"] as const,
  tags: ["tags"] as const,
  exams: ["exams"] as const,
  exam: (id: string) => ["exams", id] as const,
  assignments: (examId: string) => ["assignments", examId] as const,
  overrides: (examId: string) => ["overrides", examId] as const,
  availability: (examId: string) => ["availability", examId] as const,
};
