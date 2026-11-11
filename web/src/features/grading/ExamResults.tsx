import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ConfirmDialog } from "../../components/Dialog";
import { Badge, Button, Card, ErrorBanner, Loading } from "../../components/ui";
import { api } from "../../lib/api";
import { qk } from "../../lib/query";
import { formatInstant } from "../../lib/time";
import { useExam } from "../exams/ExamLayout";
import { GradingQueue } from "./GradingQueue";

/** /exams/:id/results: whether students see their scores, and (needs-approval exams) the grading queue. */
export function ExamResults() {
  const { exam, allowed } = useExam();
  const grading = !exam.isExternal && exam.scoringMode === "MANUAL_APPROVAL" && allowed("ATTEMPT_REVIEW");
  return (
    <div className="space-y-6">
      <ResultsRelease />
      {grading && <GradingQueue />}
    </div>
  );
}

/**
 * The staff switch for RES-3. Hidden: students see only that they submitted. Shown: each student
 * sees their own score and pass/fail, once their attempt is graded. Never their answers.
 */
function ResultsRelease() {
  const { exam, allowed } = useExam();
  const canRelease = allowed("RESULTS_RELEASE");
  const status = useQuery({ queryKey: qk.results(exam.id), queryFn: () => api.exams.results(exam.id) });
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const set = useMutation({
    mutationFn: (released: boolean) => api.exams.setResultsReleased(exam.id, released),
    onSuccess: async (next) => {
      queryClient.setQueryData(qk.results(exam.id), next);
      await queryClient.invalidateQueries({ queryKey: qk.exam(exam.id) });
      await queryClient.invalidateQueries({ queryKey: qk.exams });
    },
  });

  if (status.isPending)
    return (
      <Card title="Showing results to students">
        <Loading />
      </Card>
    );
  if (status.error)
    return (
      <Card title="Showing results to students">
        <ErrorBanner error={status.error} onRetry={() => void status.refetch()} />
      </Card>
    );
  const s = status.data;
  const ungraded = s.submitted - s.graded;

  return (
    <Card
      title="Showing results to students"
      actions={
        canRelease && (
          <Button variant={s.released ? "secondary" : "primary"} onClick={() => setConfirming(true)}>
            {s.released ? "Hide results" : "Show results to students"}
          </Button>
        )
      }
    >
      <div className="space-y-3 text-sm">
        <p className="flex flex-wrap items-center gap-2" role="status">
          {s.released ? (
            <>
              <Badge tone="green">Shown to students</Badge>
              {s.releasedAt && <span className="text-slate-600">since {formatInstant(s.releasedAt)}</span>}
            </>
          ) : (
            <Badge>Hidden from students</Badge>
          )}
        </p>
        <p className="text-slate-700">
          {s.released
            ? `Each student sees their own score and whether they passed (pass mark ${exam.passMark}%), once their attempt is graded. They never see their answers or the correct options.`
            : "Students see that they submitted, but not their score. When you show the results, each student sees their own score and whether they passed — never their answers or the correct options."}
        </p>
        <dl className="flex flex-wrap gap-6" aria-label="Grading progress">
          <div>
            <dt className="text-xs text-slate-600">Submitted</dt>
            <dd className="text-lg font-bold text-slate-800">{s.submitted}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-600">Graded</dt>
            <dd className="text-lg font-bold text-slate-800">{s.graded}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-600">Not graded yet</dt>
            <dd className="text-lg font-bold text-slate-800">{ungraded}</dd>
          </div>
        </dl>
        {ungraded > 0 && (
          <p className="rounded-lg bg-warning-50 p-3 text-warning-800">
            {ungraded} attempt{ungraded === 1 ? " isn't" : "s aren't"} graded yet.{" "}
            {s.released
              ? "Those students see “being graded” until a grader approves their attempt."
              : "If you show the results now, those students see “being graded” until a grader approves their attempt."}
          </p>
        )}
        {!canRelease && <p className="text-slate-600">Only staff allowed to publish results can change this.</p>}
      </div>

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={s.released ? "Hide the results?" : "Show the results to students?"}
        description={
          s.released
            ? `Students of “${exam.title}” no longer see their scores. Grades are kept; you can show them again.`
            : `Every student of “${exam.title}” with a graded attempt sees their score and whether they passed, on their exams page.`
        }
        confirmLabel={s.released ? "Hide results" : "Show results"}
        onConfirm={() => set.mutateAsync(!s.released)}
      />
    </Card>
  );
}
