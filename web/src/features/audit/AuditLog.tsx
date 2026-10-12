import type { AuditEntry, PersonRef } from "@contracts";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useSearchParams } from "react-router";
import { usePageTitle } from "../../app/pages";
import { SelectInput, TextInput } from "../../components/form";
import { PersonPicker } from "../../components/PersonPicker";
import { Table, type Column } from "../../components/Table";
import { Button, PageHeader } from "../../components/ui";
import { api, type AuditFilter } from "../../lib/api";
import { qk } from "../../lib/query";
import { cairoToIso, formatInstant } from "../../lib/time";

const TARGET_LINKS: Record<string, (id: string) => string> = {
  User: (id) => `/admin/users/${id}`,
  Group: (id) => `/admin/groups/${id}`,
  Exam: (id) => `/exams/${id}`,
};

/** Who did what, when, to what (append-only on the server). Super admins only for now. */
export function AuditLog() {
  usePageTitle("Audit log");
  // A page can link here pre-filtered, e.g. a user's history: ?entityType=User&entityId=…
  const [params, setParams] = useSearchParams();
  const entityType = params.get("entityType") ?? undefined;
  const entityId = params.get("entityId") ?? undefined;
  const [action, setAction] = useState("");
  const [actor, setActor] = useState<PersonRef[]>([]);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [choosingActor, setChoosingActor] = useState(false);

  const filter: AuditFilter = {
    action: action || undefined,
    actorId: actor[0]?.id,
    entityType,
    entityId,
    // Whole days in Cairo time.
    from: fromDate ? cairoToIso(fromDate, "00:00") : undefined,
    to: toDate ? new Date(new Date(cairoToIso(toDate, "23:59")).getTime() + 59_999).toISOString() : undefined,
  };
  const actions = useQuery({ queryKey: [...qk.audit, "actions"], queryFn: api.audit.actions });
  const log = useInfiniteQuery({
    queryKey: [...qk.audit, "list", filter],
    queryFn: ({ pageParam }) => api.audit.list(filter, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    staleTime: 0,
  });
  const rows = log.data?.pages.flatMap((p) => p.items);

  // Group actions by area ("users.created" → "users") so a whole area can be selected.
  const areas = [...new Set((actions.data ?? []).map((a) => a.split(".")[0]))];

  const columns: Column<AuditEntry>[] = [
    { header: "When", cell: (e) => <span className="whitespace-nowrap">{formatInstant(e.at)}</span> },
    {
      header: "Who",
      cell: (e) =>
        e.actor ? (
          <Link to={`/admin/users/${e.actor.id}`} className="text-teal-700 hover:underline">
            {e.actor.fullName}
          </Link>
        ) : (
          <span className="text-slate-500">System / deleted user</span>
        ),
    },
    { header: "Action", cell: (e) => <code className="text-xs">{e.action}</code> },
    { header: "Target", cell: (e) => <Target entry={e} /> },
    {
      header: "Details",
      cell: (e) =>
        e.detail === null || e.detail === undefined ? (
          <span className="text-slate-400">—</span>
        ) : (
          <details>
            <summary className="cursor-pointer text-sm text-teal-700">Show</summary>
            <pre className="mt-2 max-w-md overflow-x-auto rounded bg-slate-50 p-2 text-xs">
              {JSON.stringify(e.detail, null, 2)}
            </pre>
            {e.ip && <p className="mt-1 text-xs text-slate-500">IP {e.ip}</p>}
          </details>
        ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Audit log"
        description="Every staff change and sign-in, newest first. Entries can't be edited or deleted."
      />
      {entityType && (
        <div className="mb-4 flex items-center justify-between rounded-lg bg-sky-50 px-4 py-2 text-sm text-sky-800">
          <span>Showing the history of one {entityType.toLowerCase()} only.</span>
          <Button size="sm" variant="secondary" onClick={() => setParams({})}>
            Show everything
          </Button>
        </div>
      )}
      <div className="mb-4 grid gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-2 lg:grid-cols-4">
        <SelectInput label="Action" value={action} onChange={(e) => setAction(e.target.value)}>
          <option value="">All actions</option>
          {areas.map((area) => (
            <optgroup key={area} label={area}>
              <option value={`${area}.`}>All “{area}” actions</option>
              {actions.data
                ?.filter((a) => a.split(".")[0] === area)
                .map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
            </optgroup>
          ))}
        </SelectInput>
        <TextInput
          label="From (Cairo date)"
          type="date"
          value={fromDate}
          onChange={(e) => setFromDate(e.target.value)}
        />
        <TextInput label="To (Cairo date)" type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
        <div className="space-y-1">
          <span className="block text-sm font-semibold text-slate-700">Done by</span>
          {actor[0] ? (
            <div className="flex items-center justify-between gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm">
              {actor[0].fullName}
              <Button size="sm" variant="ghost" onClick={() => setActor([])} aria-label="Clear the person filter">
                Clear
              </Button>
            </div>
          ) : (
            <Button
              variant="secondary"
              className="w-full"
              onClick={() => setChoosingActor((o) => !o)}
              aria-expanded={choosingActor}
            >
              Anyone
            </Button>
          )}
        </div>
        {choosingActor && !actor[0] && (
          <div className="sm:col-span-2 lg:col-span-4">
            <PersonPicker
              label="Find a person"
              selected={actor}
              max={1}
              onChange={(people) => {
                setActor(people);
                if (people.length) setChoosingActor(false);
              }}
            />
          </div>
        )}
      </div>
      <Table
        caption="Audit log"
        columns={columns}
        rows={rows}
        rowKey={(e) => e.id}
        loading={log.isPending}
        error={log.error}
        onRetry={() => void log.refetch()}
        empty={{ title: "No entries match", hint: "Try a wider date range or another action." }}
        more={{ hasMore: !!log.hasNextPage, loading: log.isFetchingNextPage, onMore: () => void log.fetchNextPage() }}
      />
    </>
  );
}

function Target({ entry: e }: { entry: AuditEntry }) {
  if (!e.entityType) return <span className="text-slate-400">—</span>;
  const link = e.entityId ? TARGET_LINKS[e.entityType] : undefined;
  const label = `${e.entityType} ${e.entityId?.slice(0, 8) ?? ""}`;
  return link && e.entityId ? (
    <Link to={link(e.entityId)} className="text-teal-700 hover:underline">
      {label}
    </Link>
  ) : (
    <span>{label}</span>
  );
}
