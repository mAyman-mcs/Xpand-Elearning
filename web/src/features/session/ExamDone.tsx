import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router";
import { QueryErrorPage, usePageTitle } from "../../app/pages";
import { Loading } from "../../components/ui";
import { api } from "../../lib/api";
import { qk } from "../../lib/query";
import { formatInstant } from "../../lib/time";

const REASON: Record<string, string> = {
  time: "Time ran out, so your exam was submitted automatically with the answers you had saved.",
  "strike limit": "Your exam was submitted automatically because the violation limit was reached.",
};

// After the exam (NEXT_PLAN F3): how it ended, and the score once results are released.
export function ExamDone() {
  usePageTitle("Exam submitted");
  const { attemptId = "" } = useParams();
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
        <p className="mt-4 text-sm text-slate-700">
          {(o.submitReason && REASON[o.submitReason]) ?? "Your answers were submitted."}
          {o.submittedAt && <> ({formatInstant(o.submittedAt)})</>}
        </p>
      )}
      {o.result ? (
        <p className="mt-4 text-lg text-slate-800">
          Your score: <strong>{o.result.score}</strong> / {o.result.maxScore}
        </p>
      ) : (
        ended && (
          <p className="mt-4 text-sm text-slate-600">Your result appears on your exams page once it is released.</p>
        )
      )}
      <Link to="/student" replace className="mt-6 inline-block text-sm font-semibold text-teal-700 hover:underline">
        Back to my exams
      </Link>
    </div>
  );
}
