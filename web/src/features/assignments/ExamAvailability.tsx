import type { AvailabilityRow, AvailabilityStatus, OverrideAction, PersonRef } from "@contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { usePermissions } from "../../app/auth";
import { SelectInput, TextInput } from "../../components/form";
import { Table, type Column } from "../../components/Table";
import { useToast } from "../../components/Toast";
import { Badge, Button, Card, cx } from "../../components/ui";
import { api } from "../../lib/api";
import { AVAILABILITY, PROGRESS } from "../../lib/labels";
import { can } from "../../lib/permissions";
import { qk } from "../../lib/query";
import { formatInstant } from "../../lib/time";
import { useExam } from "../exams/ExamLayout";
import { NewOverrideDialog } from "./ExamOverrides";
import { GiveAnotherAttempt } from "./GiveAnotherAttempt";

const SOURCE: Record<string, string> = {
  none: "Not assigned",
  exam: "Exam status",
  attempts: "Attempts",
  "user-override": "Student override",
  "group-override": "Group override",
  "user-assignment": "Personal schedule",
  "group-assignment": "Group schedule",
};

/** /exams/:id/availability: every assigned student's status and why ("why is this open?"). */
export function ExamAvailability() {
  const { exam } = useExam();
  const rows = useQuery({
    queryKey: qk.availability(exam.id),
    queryFn: () => api.assignments.availability(exam.id),
    staleTime: 0,
  });
  const { data: perms } = usePermissions();
  const ref = { id: exam.id, categoryId: exam.category.id, tagIds: exam.tags.map((t) => t.id) };
  const mayAssign = can(perms, "EXAM_ASSIGN", ref);
  const maySchedule = can(perms, "EXAM_SCHEDULE", ref);
  const queryClient = useQueryClient();
  const toast = useToast();
  const [another, setAnother] = useState<AvailabilityRow | null>(null);
  const [override, setOverride] = useState<{ action: OverrideAction; student: PersonRef } | null>(null);
  const [status, setStatus] = useState<AvailabilityStatus | "">("");
  const [search, setSearch] = useState("");

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.data?.filter(
      (r) =>
        (!status || r.status === status) &&
        (!q || r.student.fullName.toLowerCase().includes(q) || r.student.username.toLowerCase().includes(q)),
    );
  }, [rows.data, status, search]);

  const counts = useMemo(() => {
    const c = new Map<AvailabilityStatus, number>();
    for (const r of rows.data ?? []) c.set(r.status, (c.get(r.status) ?? 0) + 1);
    return c;
  }, [rows.data]);

  const columns: Column<AvailabilityRow>[] = [
    {
      header: "Student",
      cell: (r) => (
        <span>
          <span className="font-semibold">{r.student.fullName}</span>
          <span className="block font-mono text-xs text-slate-600">{r.student.username}</span>
        </span>
      ),
    },
    { header: "Status", cell: (r) => <Badge tone={AVAILABILITY[r.status].tone}>{AVAILABILITY[r.status].label}</Badge> },
    { header: "Progress", cell: (r) => PROGRESS[r.progress] },
    {
      header: "Window",
      cell: (r) =>
        r.opensAt ? (
          <span className="text-sm">
            {formatInstant(r.opensAt)}
            <span className="block text-slate-600">→ {r.closesAt ? formatInstant(r.closesAt) : "no end"}</span>
          </span>
        ) : (
          "—"
        ),
    },
    {
      header: "Why",
      cell: (r) => (
        <span className="text-sm">
          {r.reason}
          <span className="block text-xs text-slate-600">Decided by: {SOURCE[r.source] ?? r.source}</span>
        </span>
      ),
    },
    ...(mayAssign || maySchedule
      ? [
          {
            header: "Actions",
            className: "text-right",
            cell: (r: AvailabilityRow) => (
              <div className="flex flex-wrap justify-end gap-2">
                {/* A used-up attempt needs another attempt; an override can't reopen it. */}
                {mayAssign && r.status === "SUBMITTED" && (
                  <Button
                    size="sm"
                    variant="secondary"
                    aria-label={`Give ${r.student.fullName} another attempt`}
                    onClick={() => setAnother(r)}
                  >
                    Another attempt
                  </Button>
                )}
                {maySchedule && r.status === "OPEN" && (
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`Close now for ${r.student.fullName}`}
                    onClick={() => setOverride({ action: "CLOSE", student: r.student })}
                  >
                    Close now
                  </Button>
                )}
                {maySchedule && (r.status === "CLOSED" || r.status === "SCHEDULED" || r.status === "MISSED") && (
                  <Button
                    size="sm"
                    variant="secondary"
                    aria-label={`Open now for ${r.student.fullName}`}
                    onClick={() => setOverride({ action: "OPEN", student: r.student })}
                  >
                    Open now
                  </Button>
                )}
              </div>
            ),
          },
        ]
      : []),
  ];

  return (
    <Card title="Who can take it, and why">
      <p className="mb-3 text-sm text-slate-600">Computed now by the same rules students see.</p>
      {counts.size > 0 && (
        <div className="mb-4 flex flex-wrap gap-2" role="group" aria-label="Show students by status">
          {[...counts.entries()].map(([s, n]) => {
            const on = status === s;
            return (
              <button
                key={s}
                type="button"
                aria-pressed={on}
                onClick={() => setStatus(on ? "" : s)}
                className={cx(
                  "rounded-full border px-3 py-1 text-xs font-semibold focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none",
                  on
                    ? "border-brand-700 bg-brand-700 text-white"
                    : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50",
                )}
              >
                {AVAILABILITY[s].label} · {n}
              </button>
            );
          })}
        </div>
      )}
      <div className="mb-4 grid gap-3 sm:grid-cols-2">
        <TextInput
          label="Search"
          type="search"
          placeholder="Name or username"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <SelectInput
          label="Status"
          value={status}
          onChange={(e) => setStatus(e.target.value as AvailabilityStatus | "")}
        >
          <option value="">Any status</option>
          {(Object.keys(AVAILABILITY) as AvailabilityStatus[])
            .filter((s) => s !== "NOT_ASSIGNED")
            .map((s) => (
              <option key={s} value={s}>
                {AVAILABILITY[s].label}
              </option>
            ))}
        </SelectInput>
      </div>
      <Table
        caption="Availability"
        columns={columns}
        rows={visible}
        rowKey={(r) => r.student.id}
        loading={rows.isPending}
        error={rows.error}
        onRetry={() => void rows.refetch()}
        empty={{
          title: rows.data?.length ? "Nobody matches" : "Not assigned to any student you can see",
          hint: rows.data?.length ? undefined : "Assign it under “Assigned to” below.",
        }}
      />
      {override && (
        <NewOverrideDialog
          examId={exam.id}
          initial={override}
          onClose={() => setOverride(null)}
          onSaved={async (action) => {
            await queryClient.invalidateQueries({ queryKey: qk.overrides(exam.id) });
            await queryClient.invalidateQueries({ queryKey: qk.availability(exam.id) });
            await queryClient.invalidateQueries({ queryKey: qk.stats });
            toast(action === "OPEN" ? "Exam opened" : "Exam closed");
          }}
        />
      )}
      {another && (
        <GiveAnotherAttempt
          target={{ exam: { ...ref, title: exam.title }, student: another.student }}
          onClose={() => setAnother(null)}
        />
      )}
    </Card>
  );
}
