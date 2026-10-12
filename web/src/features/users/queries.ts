import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { api, type UserListFilter } from "../../lib/api";
import { qk } from "../../lib/query";

/** Cursor-paginated user list ("Load more"); filters are applied by the server, inside the caller's scope. */
export function useUsers(filter: UserListFilter) {
  const query = useInfiniteQuery({
    queryKey: [...qk.users, "list", filter],
    queryFn: ({ pageParam }) => api.users.list(filter, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  return { ...query, rows: query.data?.pages.flatMap((p) => p.items) };
}

export function useUser(id: string) {
  return useQuery({ queryKey: qk.user(id), queryFn: () => api.users.get(id) });
}

export function useGroups() {
  return useQuery({ queryKey: qk.groups, queryFn: api.groups.list });
}
