import { useQuery } from "@tanstack/react-query";
import { Link, useLocation, useParams } from "react-router";
import { QueryErrorPage, usePageTitle } from "../../app/pages";
import { Loading } from "../../components/ui";
import { api } from "../../lib/api";
import { qk } from "../../lib/query";
import { formatInstant } from "../../lib/time";
import type { DoneState } from "./ExamSession";

const REASON: Record<string, string> = {
  time: "Time ran out, so your exam was submitted automatically with the answers you had saved.",
  "strike limit": "Your exam was submitted automatically because the warning limit was reached.",
};

// After the exam (NEXT_PLAN F3): how it ended, and the score once results are released.
export function ExamDone() {
  usePageTitle("Exam submitted");
  const { attemptId = "" } = useParams();
  // Passed by the exam page on the way out; absent after a reload (then the count isn't shown).
  const progress = (useLocation().state as DoneState | null) ?? null;
  const outcome = useQuery({ queryKey: qk.outcome(attemptId), queryFn: () => api.attempts.outcome(attemptId) });

  if (outcome.isPending) return <Loading />;
  if (outcome.error) return <QueryErrorPage error={outcome.error} />;
  const o = outcome.data;
  const ended = o.status !== "IN_PROGRESS";

  return (
    <div className="mx-auto mt-16 max-w-lg rounded-xl border border-slate-200 bg-white p-8 text-center shadow-sm">
      <h1 className="text-2xl font-extrabold text-slate-800">{ended ? "Exam submitted" : "Exam in progress"}</h1>
      <p className="mt-1 text-sm text-slate-600">{o.examTitle}</p>
      {ended && (
        <>
          <p className="mt-4 text-sm text-slate-700">
            {(o.submitReason && REASON[o.submitReason]) ?? "Your answers were submitted."}
          </p>
          {/* A receipt the student can quote if anything is ever questioned. */}
          <dl className="mt-4 grid gap-2 rounded-lg bg-slate-50 p-4 text-left text-sm sm:grid-cols-3">
            {progress && (
              <div>
                <dt className="text-xs text-slate-600">Answered</dt>
                <dd className="font-semibold text-slate-800">
                  {progress.answered} of {progress.total}
                </dd>
              </div>
            )}
            {o.submittedAt && (
              <div>
                <dt className="text-xs text-slate-600">Submitted</dt>
                <dd className="font-semibold text-slate-800">{formatInstant(o.submittedAt)}</dd>
              </div>
            )}
            <div>
              <dt className="text-xs text-slate-600">Reference</dt>
              <dd className="font-mono font-semibold text-slate-800">{o.attemptId.slice(0, 8).toUpperCase()}</dd>
            </div>
          </dl>
        </>
      )}
      {o.result ? (
        <p className="mt-4 text-lg text-slate-800">
          Your score: <strong>{o.result.score}</strong> / {o.result.maxScore}
        </p>
      ) : (
        ended && (
          <p className="mt-4 text-sm text-slate-600">
            {o.awaitingGrading
              ? "Your score will be available after your answers are graded. It appears on your exams page once it is released."
              : "Your result appears on your exams page once it is released."}
          </p>
        )
      )}
      <Link to="/student" replace className="mt-6 inline-block text-sm font-semibold text-brand-700 hover:underline">
        Back to my exams
      </Link>
    </div>
  );
}
