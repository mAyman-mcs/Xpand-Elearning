import type { AttemptStatus, SubmissionRow } from "@contracts";
import { useState } from "react";
import { Link } from "react-router";
import { usePermissions } from "../../app/auth";
import { Table, type Column } from "../../components/Table";
import { Badge, Button } from "../../components/ui";
import { can } from "../../lib/permissions";
import { formatInstant } from "../../lib/time";
import { GiveAnotherAttempt, type AnotherAttemptTarget } from "../assignments/GiveAnotherAttempt";

const HOW: Partial<Record<AttemptStatus, string>> = {
  AUTO_SUBMITTED: "Submitted automatically",
  FORCE_SUBMITTED: "Submitted by staff",
};

/** The result column: the score, or why there is none yet. */
export function ResultBadge({ row }: { row: Pick<SubmissionRow, "awaitingGrading" | "score" | "maxScore"> }) {
  if (row.awaitingGrading) return <Badge tone="amber">Awaiting grading</Badge>;
  if (row.score === null || row.maxScore === null) return <span className="text-slate-600">—</span>;
  return (
    <span className="font-semibold text-slate-800 tabular-nums">
      {row.score} / {row.maxScore}
    </span>
  );
}

/** Submitted exams with Preview, Grade and "Another attempt" actions. */
export function SubmissionsTable({
  rows,
  loading,
  error,
  onRetry,
  more,
  empty,
}: {
  rows: SubmissionRow[] | undefined;
  loading: boolean;
  error: unknown;
  onRetry: () => void;
  more?: { hasMore: boolean; loading: boolean; onMore: () => void };
  empty: { title: string; hint?: string };
}) {
  const { data: perms } = usePermissions();
  const [another, setAnother] = useState<AnotherAttemptTarget | null>(null);
  // What the UI offers; the server decides per exam and student.
  const mayGrade = can(perms, "ATTEMPT_REVIEW");
  const mayAssign = can(perms, "EXAM_ASSIGN");

  const columns: Column<SubmissionRow>[] = [
    {
      header: "Student",
      cell: (r) => (
        <>
          <span className="font-semibold text-slate-800">{r.student.fullName}</span>
          <span className="block text-xs text-slate-600">
            {r.student.username}
            {r.attemptNo > 1 && ` · attempt ${r.attemptNo}`}
          </span>
        </>
      ),
    },
    {
      header: "Exam",
      cell: (r) => (
        <>
          <span className="text-slate-800">{r.exam.title}</span>
          <span className="block font-mono text-xs text-slate-600">{r.exam.code}</span>
        </>
      ),
    },
    {
      header: "Submitted",
      cell: (r) => (
        <>
          {formatInstant(r.submittedAt)}
          {HOW[r.status] && <span className="block text-xs text-slate-600">{HOW[r.status]}</span>}
        </>
      ),
    },
    { header: "Result", cell: (r) => <ResultBadge row={r} /> },
    {
      header: "Actions",
      cell: (r) => (
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <Link
            to={`/submissions/${r.attemptId}`}
            className="font-semibold text-brand-700 hover:underline"
            aria-label={`Preview ${r.student.fullName}'s ${r.exam.title}`}
          >
            Preview
          </Link>
          {r.awaitingGrading && mayGrade && (
            <Link
              to={`/grading/${r.attemptId}`}
              className="font-semibold text-brand-700 hover:underline"
              aria-label={`Grade ${r.student.fullName}'s ${r.exam.title}`}
            >
              Grade
            </Link>
          )}
          {r.isLatest && mayAssign && (
            <Button
              size="sm"
              variant="ghost"
              aria-label={`Give ${r.student.fullName} another attempt at ${r.exam.title}`}
              onClick={() => setAnother({ exam: r.exam, student: r.student })}
            >
              Another attempt
            </Button>
          )}
        </span>
      ),
    },
  ];

  return (
    <>
      <Table
        caption="Submitted exams"
        columns={columns}
        rows={rows}
        rowKey={(r) => r.attemptId}
        loading={loading}
        error={error}
        onRetry={onRetry}
        empty={empty}
        more={more}
      />
      {another && <GiveAnotherAttempt target={another} onClose={() => setAnother(null)} />}
    </>
  );
}
