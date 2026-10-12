import type { Exam, ExamStatus } from "@contracts";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useSearchParams } from "react-router";
import { usePermissions } from "../../app/auth";
import { usePageTitle } from "../../app/pages";
import { SelectInput, TextInput } from "../../components/form";
import { Table, type Column } from "../../components/Table";
import { Badge, ButtonLink, cx, PageHeader } from "../../components/ui";
import { api, type ExamListFilter } from "../../lib/api";
import { useDebounced } from "../../lib/forms";
import { EXAM_STATUS } from "../../lib/labels";
import { can } from "../../lib/permissions";
import { qk } from "../../lib/query";
import { formatMinutes } from "../../lib/time";
import { useCategories, useTags } from "../catalog/queries";

/** Exams in the caller's reach; filters are applied by the server inside that reach. */
export function ExamsList() {
  usePageTitle("Exams");
  const [params] = useSearchParams();
  const { data: perms } = usePermissions();
  const [search, setSearch] = useState("");
  const [categoryId, setCategoryId] = useState(params.get("categoryId") ?? "");
  const [status, setStatus] = useState<ExamStatus | "">((params.get("status") as ExamStatus | null) ?? "");
  const [tagIds, setTagIds] = useState<string[]>([]);
  const q = useDebounced(search.trim());
  const categories = useCategories();
  const tags = useTags();

  const filter: ExamListFilter = {
    q: q || undefined,
    categoryId: categoryId || undefined,
    status: status || undefined,
    tagIds,
  };
  const exams = useInfiniteQuery({
    queryKey: [...qk.exams, "list", filter],
    queryFn: ({ pageParam }) => api.exams.list(filter, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const rows = exams.data?.pages.flatMap((p) => p.items);
  const total = exams.data?.pages[0]?.total;

  const columns: Column<Exam>[] = [
    {
      header: "Exam",
      cell: (e) => (
        <Link to={`/exams/${e.id}`} className="font-semibold text-teal-700 hover:underline">
          {e.title}
          <span className="block font-mono text-xs font-normal text-slate-600">{e.code}</span>
        </Link>
      ),
    },
    { header: "Category", cell: (e) => e.category.name },
    {
      header: "Tags",
      cell: (e) => (
        <span className="flex flex-wrap gap-1">
          {e.tags.map((t) => (
            <Badge key={t.id}>{t.name}</Badge>
          ))}
        </span>
      ),
    },
    { header: "Duration", cell: (e) => (e.isExternal ? "External" : formatMinutes(e.durationMinutes)) },
    { header: "Status", cell: (e) => <Badge tone={EXAM_STATUS[e.status].tone}>{EXAM_STATUS[e.status].label}</Badge> },
  ];

  return (
    <>
      <PageHeader
        title="Exams"
        description={total !== undefined ? `${total} exam${total === 1 ? "" : "s"} match.` : undefined}
        actions={
          <>
            {can(perms, "EXAM_ASSIGN") && (
              <ButtonLink to="/assignments/new" variant="secondary">
                Assign several exams
              </ButtonLink>
            )}
            {can(perms, "EXAM_EDIT") && <ButtonLink to="/exams/new">New exam</ButtonLink>}
          </>
        }
      />
      <div className="mb-4 space-y-3 rounded-xl border border-slate-200 bg-white p-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <TextInput
            label="Search"
            type="search"
            placeholder="Title or code"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <SelectInput label="Category" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="">All categories</option>
            {categories.data?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </SelectInput>
          <SelectInput label="Status" value={status} onChange={(e) => setStatus(e.target.value as ExamStatus | "")}>
            <option value="">Any status</option>
            {(Object.keys(EXAM_STATUS) as ExamStatus[]).map((s) => (
              <option key={s} value={s}>
                {EXAM_STATUS[s].label}
              </option>
            ))}
          </SelectInput>
        </div>
        {!!tags.data?.length && (
          <fieldset>
            <legend className="mb-1 text-sm font-semibold text-slate-700">Tags (all of)</legend>
            <div className="flex flex-wrap gap-2">
              {tags.data.map((t) => {
                const on = tagIds.includes(t.id);
                return (
                  <button
                    key={t.id}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setTagIds(on ? tagIds.filter((x) => x !== t.id) : [...tagIds, t.id])}
                    className={cx(
                      "rounded-full border px-3 py-1 text-xs font-semibold",
                      on
                        ? "border-teal-700 bg-teal-700 text-white"
                        : "border-slate-300 text-slate-600 hover:bg-slate-50",
                    )}
                  >
                    {t.name}
                  </button>
                );
              })}
            </div>
          </fieldset>
        )}
      </div>
      <Table
        caption="Exams"
        columns={columns}
        rows={rows}
        rowKey={(e) => e.id}
        loading={exams.isPending}
        error={exams.error}
        onRetry={() => void exams.refetch()}
        empty={{
          title: "No exams match",
          hint: search || categoryId || status || tagIds.length ? "Try other filters." : undefined,
        }}
        more={{
          hasMore: !!exams.hasNextPage,
          loading: exams.isFetchingNextPage,
          onMore: () => void exams.fetchNextPage(),
        }}
      />
    </>
  );
}
