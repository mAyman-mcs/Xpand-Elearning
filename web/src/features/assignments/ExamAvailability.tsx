import type { AvailabilityRow, AvailabilityStatus } from "@contracts";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { SelectInput, TextInput } from "../../components/form";
import { Table, type Column } from "../../components/Table";
import { Badge, Card } from "../../components/ui";
import { api } from "../../lib/api";
import { AVAILABILITY, PROGRESS } from "../../lib/labels";
import { qk } from "../../lib/query";
import { formatInstant } from "../../lib/time";
import { useExam } from "../exams/ExamLayout";

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
  ];

  return (
    <Card title="Who can take it, and why">
      <p className="mb-4 text-sm text-slate-600">
        Computed now by the same rules students see. Statuses:{" "}
        {[...counts.entries()].map(([s, n]) => `${AVAILABILITY[s].label} ${n}`).join(" · ") || "—"}
      </p>
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
          hint: rows.data?.length ? undefined : "Assign it on the Assignments tab.",
        }}
      />
    </Card>
  );
}
