import type { SubmissionRow } from "@contracts";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { usePermissions } from "../../app/auth";
import { Table, type Column } from "../../components/Table";
import { Badge, Card } from "../../components/ui";
import { api, type SubmissionFilter } from "../../lib/api";
import { can } from "../../lib/permissions";
import { qk } from "../../lib/query";
import { formatInstant } from "../../lib/time";
import { scoreSummary } from "../student/StudentHome";
import { ResultBadge } from "../submissions/SubmissionsTable";

/** Pass or fail, once there is a score. */
export function PassFail({ row }: { row: SubmissionRow }) {
  if (row.awaitingGrading || row.score === null || row.maxScore === null) return null;
  const { percent, passed } = scoreSummary(row.score, row.maxScore, row.exam.passMark);
  return (
    <span className="mt-1 flex flex-wrap items-center gap-1 text-xs text-slate-600">
      {percent}%<Badge tone={passed ? "green" : "red"}>{passed ? "Passed" : "Failed"}</Badge>
    </span>
  );
}

/** The user page of a student: every exam they submitted, within the caller's reach, newest first. */
export function ExamHistory({ userId }: { userId: string }) {
  const { data: perms } = usePermissions();
  const mayGrade = can(perms, "ATTEMPT_REVIEW");
  const filter: SubmissionFilter = { userId };
  const list = useInfiniteQuery({
    queryKey: [...qk.submissions, "list", filter],
    queryFn: ({ pageParam }) => api.submissions.list(filter, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    staleTime: 0,
  });
  const rows = list.data?.pages.flatMap((p) => p.items);

  const columns: Column<SubmissionRow>[] = [
    {
      header: "Exam",
      cell: (r) => (
        <>
          <span className="text-slate-800">{r.exam.title}</span>
          <span className="block font-mono text-xs text-slate-600">
            {r.exam.code}
            {r.attemptNo > 1 && ` · attempt ${r.attemptNo}`}
          </span>
        </>
      ),
    },
    {
      header: "Submitted",
      cell: (r) => (
        <>
          {formatInstant(r.submittedAt)}
          {r.status === "VOIDED" && (
            <span className="mt-1 block">
              <Badge tone="gray">Voided</Badge>
            </span>
          )}
        </>
      ),
    },
    {
      header: "Result",
      cell: (r) => (
        <>
          <ResultBadge row={r} />
          <PassFail row={r} />
        </>
      ),
    },
    {
      header: "Student sees it",
      cell: (r) => (r.exam.resultsReleased ? <Badge tone="green">Shown</Badge> : <Badge tone="gray">Hidden</Badge>),
    },
    {
      header: "Actions",
      cell: (r) => (
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <Link
            to={`/submissions/${r.attemptId}`}
            className="font-semibold text-brand-700 hover:underline"
            aria-label={`Preview ${r.exam.title}`}
          >
            Preview
          </Link>
          {r.awaitingGrading && mayGrade && (
            <Link
              to={`/grading/${r.attemptId}`}
              className="font-semibold text-brand-700 hover:underline"
              aria-label={`Grade ${r.exam.title}`}
            >
              Grade
            </Link>
          )}
        </span>
      ),
    },
  ];

  return (
    <Card title="Exam history">
      <Table
        caption="Exam history"
        columns={columns}
        rows={rows}
        rowKey={(r) => r.attemptId}
        loading={list.isPending}
        error={list.error}
        onRetry={() => void list.refetch()}
        empty={{ title: "No exams taken yet" }}
        more={{
          hasMore: !!list.hasNextPage,
          loading: list.isFetchingNextPage,
          onMore: () => void list.fetchNextPage(),
        }}
      />
    </Card>
  );
}
