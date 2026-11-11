import type { GradingQueueRow, ReviewStatus } from "@contracts";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router";
import { SelectInput } from "../../components/form";
import { Table, type Column } from "../../components/Table";
import { Badge, Card, type BadgeTone } from "../../components/ui";
import { api } from "../../lib/api";
import { qk } from "../../lib/query";
import { formatInstant } from "../../lib/time";
import { useExam } from "../exams/ExamLayout";

export const REVIEW_STATUS: Record<ReviewStatus, { label: string; tone: BadgeTone }> = {
  PENDING: { label: "Not graded", tone: "amber" },
  UNDER_REVIEW: { label: "Grading started", tone: "blue" },
  REVIEWED: { label: "Approved", tone: "green" },
};

type Filter = ReviewStatus | "NOT_REVIEWED" | "ALL";

/** /exams/:id/grading: finished attempts of a "needs approval" exam, oldest first. */
export function GradingQueue() {
  const { exam } = useExam();
  const [filter, setFilter] = useState<Filter>("NOT_REVIEWED");
  const queue = useInfiniteQuery({
    queryKey: [...qk.gradingQueue(exam.id), filter],
    queryFn: ({ pageParam }) => api.grading.queue(exam.id, filter === "ALL" ? undefined : filter, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    staleTime: 0,
  });
  const rows = queue.data?.pages.flatMap((p) => p.items);
  const counts = queue.data?.pages[0]?.counts;

  const columns: Column<GradingQueueRow>[] = [
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
    { header: "Submitted", cell: (r) => (r.submittedAt ? formatInstant(r.submittedAt) : "—") },
    {
      header: "Status",
      cell: (r) => <Badge tone={REVIEW_STATUS[r.reviewStatus].tone}>{REVIEW_STATUS[r.reviewStatus].label}</Badge>,
    },
    {
      header: "Essays graded",
      cell: (r) => (r.essays.answered ? `${r.essays.graded} of ${r.essays.answered}` : "No essays answered"),
    },
    {
      header: "Score",
      cell: (r) => (r.score !== null && r.maxScore !== null ? `${r.score} / ${r.maxScore}` : "—"),
    },
    {
      header: "Last graded by",
      cell: (r) =>
        r.lastGradedBy ? (
          <>
            {r.lastGradedBy.fullName}
            {r.lastGradedAt && <span className="block text-xs text-slate-600">{formatInstant(r.lastGradedAt)}</span>}
          </>
        ) : (
          "—"
        ),
    },
    {
      header: "Action",
      cell: (r) => (
        <Link
          to={`/grading/${r.attemptId}`}
          className="font-semibold text-brand-700 hover:underline"
          aria-label={`${r.reviewStatus === "REVIEWED" ? "View" : "Grade"} ${r.student.fullName}`}
        >
          {r.reviewStatus === "REVIEWED" ? "View" : "Grade"}
        </Link>
      ),
    },
  ];

  return (
    <Card title="Grading">
      <p className="mb-4 text-sm text-slate-600">
        This exam needs approval: each submitted attempt gets its score when a grader approves it. Students see the
        score once the attempt is approved and results are released.
      </p>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-4">
        {counts && (
          <dl className="flex flex-wrap gap-6 text-sm" aria-label="Grading progress">
            <div>
              <dt className="text-xs text-slate-600">Not graded</dt>
              <dd className="text-lg font-bold text-slate-800">{counts.pending}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-600">Grading started</dt>
              <dd className="text-lg font-bold text-slate-800">{counts.underReview}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-600">Approved</dt>
              <dd className="text-lg font-bold text-slate-800">{counts.reviewed}</dd>
            </div>
          </dl>
        )}
        <div className="w-56">
          <SelectInput label="Show" value={filter} onChange={(e) => setFilter(e.target.value as Filter)}>
            <option value="NOT_REVIEWED">Not approved yet</option>
            <option value="PENDING">Not graded</option>
            <option value="UNDER_REVIEW">Grading started</option>
            <option value="REVIEWED">Approved</option>
            <option value="ALL">All</option>
          </SelectInput>
        </div>
      </div>
      <Table
        caption="Attempts to grade"
        columns={columns}
        rows={rows}
        rowKey={(r) => r.attemptId}
        loading={queue.isPending}
        error={queue.error}
        onRetry={() => void queue.refetch()}
        empty={{
          title: filter === "NOT_REVIEWED" ? "Nothing to grade" : "No attempts",
          hint: "Attempts appear here when students in your scope submit this exam.",
        }}
        more={{
          hasMore: !!queue.hasNextPage,
          loading: queue.isFetchingNextPage,
          onMore: () => void queue.fetchNextPage(),
        }}
      />
    </Card>
  );
}
