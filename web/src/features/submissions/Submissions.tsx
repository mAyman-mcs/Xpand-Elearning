import { useInfiniteQuery } from "@tanstack/react-query";
import { useState } from "react";
import { usePageTitle } from "../../app/pages";
import { SelectInput, TextInput } from "../../components/form";
import { Card, PageHeader } from "../../components/ui";
import { api, type SubmissionFilter } from "../../lib/api";
import { useUrlFilters } from "../../lib/forms";
import { qk } from "../../lib/query";
import { SubmissionsTable } from "./SubmissionsTable";

type Show = NonNullable<SubmissionFilter["show"]>;

/** /submissions: every submitted exam the caller may see, newest first, across all exams. */
export function Submissions() {
  usePageTitle("Submissions");
  // Filters live in the URL (the dashboard links to ?show=awaiting-grading), so Back keeps them.
  const filters = useUrlFilters({ show: "all", q: "" });
  const show: Show = filters.values.show === "awaiting-grading" ? "awaiting-grading" : "all";
  const { q } = filters.values;
  const [search, setSearch] = useState(q);

  const filter: SubmissionFilter = { show, q: q || undefined };
  const list = useInfiniteQuery({
    queryKey: [...qk.submissions, "list", filter],
    queryFn: ({ pageParam }) => api.submissions.list(filter, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    staleTime: 0,
  });

  return (
    <>
      <PageHeader
        title="Submissions"
        description="Submitted exams of the students you can see, newest first. Preview one to see every answer."
      />
      <Card>
        <form
          className="mb-4 grid gap-3 sm:grid-cols-[1fr_14rem_auto] sm:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            filters.set({ q: search.trim() });
          }}
        >
          <TextInput
            label="Search"
            type="search"
            placeholder="Student or exam"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              if (!e.target.value) filters.set({ q: "" });
            }}
          />
          <SelectInput label="Show" value={show} onChange={(e) => filters.set({ show: e.target.value })}>
            <option value="all">All submissions</option>
            <option value="awaiting-grading">Awaiting grading</option>
          </SelectInput>
          <button type="submit" className="sr-only">
            Search
          </button>
        </form>
        <SubmissionsTable
          rows={list.data?.pages.flatMap((p) => p.items)}
          loading={list.isPending}
          error={list.error}
          onRetry={() => void list.refetch()}
          more={{
            hasMore: !!list.hasNextPage,
            loading: list.isFetchingNextPage,
            onMore: () => void list.fetchNextPage(),
          }}
          empty={
            q || show !== "all"
              ? { title: "Nothing matches", hint: "Try another search, or show all submissions." }
              : {
                  title: "No submissions yet",
                  hint: "Submitted exams appear here when students you can see finish an exam you can see results of.",
                }
          }
        />
      </Card>
    </>
  );
}
