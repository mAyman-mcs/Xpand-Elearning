import type { GradingQuestion } from "@contracts";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useParams } from "react-router";
import { QueryErrorPage, usePageTitle } from "../../app/pages";
import { Badge, Button, ButtonLink, Card, Loading, PageHeader } from "../../components/ui";
import { api } from "../../lib/api";
import { qk } from "../../lib/query";
import { formatInstant } from "../../lib/time";
import { GiveAnotherAttempt } from "../assignments/GiveAnotherAttempt";
import { AttemptBlocks, QuestionBody } from "../grading/AttemptView";
import { REVIEW_STATUS } from "../grading/GradingQueue";
import { ResultBadge } from "./SubmissionsTable";

/** /submissions/:attemptId: one submitted exam, read only, whatever its scoring mode. */
export function SubmissionPreview() {
  const { attemptId = "" } = useParams();
  const query = useQuery({
    queryKey: qk.submission(attemptId),
    queryFn: () => api.submissions.get(attemptId),
    staleTime: 0,
  });
  const [another, setAnother] = useState(false);
  usePageTitle(query.data ? `${query.data.student.fullName}: ${query.data.exam.title}` : "Submission");

  if (query.isPending) return <Loading />;
  if (query.error) return <QueryErrorPage error={query.error} />;
  const a = query.data;
  const manual = a.exam.scoringMode === "MANUAL_APPROVAL";

  return (
    <>
      <Link to="/submissions" className="text-sm font-semibold text-teal-700 hover:underline">
        ← Submissions
      </Link>
      <PageHeader
        title={a.student.fullName}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <span>
              {a.student.username} · {a.exam.title} ({a.exam.code}){a.attemptNo > 1 && ` · attempt ${a.attemptNo}`}
            </span>
            {a.status === "VOIDED" ? (
              <Badge tone="red">Voided</Badge>
            ) : (
              manual && <Badge tone={REVIEW_STATUS[a.reviewStatus].tone}>{REVIEW_STATUS[a.reviewStatus].label}</Badge>
            )}
          </span>
        }
        actions={
          <>
            {a.canGrade && (
              <ButtonLink to={`/grading/${a.attemptId}`} variant="secondary">
                {a.reviewStatus === "REVIEWED" ? "Open grading" : "Grade"}
              </ButtonLink>
            )}
            {a.canGiveAnotherAttempt && <Button onClick={() => setAnother(true)}>Give another attempt</Button>}
          </>
        }
      />

      <Card className="mb-4">
        <dl className="grid gap-4 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-xs text-slate-600">Submitted</dt>
            <dd className="font-medium text-slate-800">
              {formatInstant(a.submittedAt)}
              {a.submitReason && <span className="block text-xs text-slate-600">{a.submitReason}</span>}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-slate-600">Result</dt>
            <dd>
              <ResultBadge row={{ awaitingGrading: manual && a.reviewStatus !== "REVIEWED", ...a }} />
            </dd>
          </div>
          <div>
            <dt className="text-xs text-slate-600">Answered</dt>
            <dd className="font-medium text-slate-800">
              {a.questions.filter((q) => q.answered).length} of {a.questions.length} questions
            </dd>
          </div>
        </dl>
      </Card>

      <AttemptBlocks questions={a.questions} cases={a.cases} card={(q) => <PreviewCard key={q.id} q={q} />} />

      {another && (
        <GiveAnotherAttempt
          target={{ exam: a.exam, student: a.student }}
          onClose={() => {
            setAnother(false);
            void query.refetch();
          }}
        />
      )}
    </>
  );
}

function PreviewCard({ q }: { q: GradingQuestion }) {
  const points = q.awardedPoints ?? q.autoPoints;
  return (
    <Card>
      <QuestionBody q={q} />
      <p className="mt-3 text-sm text-slate-700">
        Points:{" "}
        <strong className="tabular-nums">{points === null ? (q.type === "ESSAY" ? "not graded" : "—") : points}</strong>
        {points !== null && ` / ${q.points}`}
      </p>
      {q.feedback && <p className="mt-1 text-sm text-slate-700">Feedback: {q.feedback}</p>}
    </Card>
  );
}
