import type { GradingAttempt, GradingQuestion } from "@contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { QueryErrorPage, usePageTitle } from "../../app/pages";
import { ConfirmDialog } from "../../components/Dialog";
import { FormError, TextArea, TextInput } from "../../components/form";
import { useToast } from "../../components/Toast";
import { Badge, Button, Card, cx, Loading, PageHeader } from "../../components/ui";
import { api, ApiError, errorMessage } from "../../lib/api";
import {
  changedGrades,
  draftProblem,
  draftProblems,
  draftsOf,
  draftTotal,
  isOverride,
  type Draft,
} from "../../lib/grading";
import { qk } from "../../lib/query";
import { QUESTION_TYPE_LABEL } from "../../lib/questions";
import { formatInstant } from "../../lib/time";
import { REVIEW_STATUS } from "./GradingQueue";

/** /grading/:attemptId: one attempt, question by question; save a draft, approve, go to the next. */
export function GradeAttempt() {
  const { attemptId = "" } = useParams();
  const attempt = useQuery({
    queryKey: qk.grading(attemptId),
    queryFn: () => api.grading.get(attemptId),
    staleTime: 0,
  });
  usePageTitle(attempt.data ? `Grading: ${attempt.data.student.fullName}` : "Grading");

  if (attempt.isPending) return <Loading />;
  if (attempt.error) return <QueryErrorPage error={attempt.error} />;
  // Keyed by version: a reload after someone else's change starts from their grading.
  return <Grader key={`${attempt.data.attemptId}:${attempt.data.gradingVersion}`} attempt={attempt.data} />;
}

function Grader({ attempt: a }: { attempt: GradingAttempt }) {
  const client = useQueryClient();
  const navigate = useNavigate();
  const toast = useToast();
  const [drafts, setDrafts] = useState<Record<string, Draft>>(() => draftsOf(a));
  const [conflict, setConflict] = useState(false);
  const [reopening, setReopening] = useState(false);
  const approved = a.reviewStatus === "REVIEWED";
  const changes = changedGrades(a, drafts);
  const problems = draftProblems(a, drafts);
  const invalid = a.questions.some((q) => drafts[q.id] && draftProblem(q, drafts[q.id]!));
  const dirty = changes.length > 0;

  // Leaving with unsaved grading asks first (the browser's own prompt).
  useEffect(() => {
    if (!dirty) return;
    const onUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", onUnload);
    return () => window.removeEventListener("beforeunload", onUnload);
  }, [dirty]);

  const done = async (next: GradingAttempt) => {
    client.setQueryData(qk.grading(a.attemptId), next);
    await client.invalidateQueries({ queryKey: qk.gradingQueue(a.exam.id) });
  };
  const onError = (e: unknown) => {
    if (e instanceof ApiError && e.code === "GRADING_CONFLICT") setConflict(true);
  };

  const save = useMutation({
    mutationFn: () => api.grading.save(a.attemptId, a.gradingVersion, changes),
    onSuccess: async (next) => {
      await done(next);
      toast("Grading saved");
    },
    onError,
  });
  const approve = useMutation({
    mutationFn: async () => {
      // Unsaved changes go first, then the approval with the version they produced.
      const version = dirty
        ? (await api.grading.save(a.attemptId, a.gradingVersion, changes)).gradingVersion
        : a.gradingVersion;
      return api.grading.approve(a.attemptId, version);
    },
    onSuccess: async (next) => {
      await done(next);
      toast(`Approved: ${next.score} / ${next.maxScore}`);
    },
    onError: (e) => {
      onError(e);
      // The draft may have been saved before the approval failed: reload to get its new version.
      if (!(e instanceof ApiError && e.code === "GRADING_CONFLICT") && dirty)
        void client.invalidateQueries({ queryKey: qk.grading(a.attemptId) });
    },
  });
  const busy = save.isPending || approve.isPending;
  const error = save.error ?? approve.error;

  const set = (questionId: string, patch: Partial<Draft>) =>
    setDrafts((d) => ({ ...d, [questionId]: { ...d[questionId]!, ...patch } }));

  return (
    <>
      <PageHeader
        title={a.student.fullName}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <span>
              {a.student.username} · {a.exam.title}
              {a.attemptNo > 1 && ` · attempt ${a.attemptNo}`}
            </span>
            <Badge tone={REVIEW_STATUS[a.reviewStatus].tone}>{REVIEW_STATUS[a.reviewStatus].label}</Badge>
          </span>
        }
        actions={
          <Link to={`/exams/${a.exam.id}/grading`} className="text-sm font-semibold text-teal-700 hover:underline">
            Back to the grading list
          </Link>
        }
      />

      {conflict && (
        <div
          role="alert"
          className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"
        >
          Someone else changed this grading. Reload to see their changes (yours are not saved).
          <Button
            size="sm"
            variant="secondary"
            onClick={() => void client.invalidateQueries({ queryKey: qk.grading(a.attemptId) })}
          >
            Reload
          </Button>
        </div>
      )}
      {approved && (
        <p className="mb-4 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">
          Approved{a.reviewedBy && ` by ${a.reviewedBy.fullName}`}
          {a.reviewedAt && ` on ${formatInstant(a.reviewedAt)}`}. Score: <strong>{a.score}</strong> / {a.maxScore}.
          Reopen it to change the grading.
        </p>
      )}
      <p className="mb-4 text-sm text-slate-600">
        Submitted {a.submittedAt ? formatInstant(a.submittedAt) : "—"}
        {a.submitReason && ` (${a.submitReason})`}.
      </p>

      <ol className="space-y-4" aria-label="Questions">
        {a.questions.map((q, i) => (
          <li key={q.id}>
            <QuestionCard
              n={i + 1}
              q={q}
              draft={drafts[q.id]!}
              readOnly={approved || busy}
              onChange={(patch) => set(q.id, patch)}
            />
          </li>
        ))}
      </ol>

      <div className="sticky bottom-0 z-10 mt-6 border-t border-slate-200 bg-white/95 py-3 backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-slate-700" aria-live="polite">
            Total: <strong className="tabular-nums">{approved ? a.score : draftTotal(a, drafts)}</strong> / {a.maxScore}
            {!approved && problems.length > 0 && <span className="block text-xs text-amber-800">{problems[0]}</span>}
          </p>
          <div className="flex flex-wrap gap-2">
            {approved ? (
              <Button variant="secondary" onClick={() => setReopening(true)}>
                Reopen
              </Button>
            ) : (
              <>
                <Button
                  variant="secondary"
                  busy={save.isPending}
                  disabled={!dirty || invalid || busy}
                  onClick={() => save.mutate()}
                >
                  Save draft
                </Button>
                <Button
                  busy={approve.isPending}
                  disabled={problems.length > 0 || busy}
                  onClick={() => approve.mutate()}
                >
                  Approve
                </Button>
              </>
            )}
            {a.nextUngradedId && (
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => void navigate(`/grading/${a.nextUngradedId}`)}
                title={dirty ? "Save first: unsaved grading is lost." : undefined}
              >
                Next ungraded →
              </Button>
            )}
          </div>
        </div>
        <FormError message={error && !conflict ? errorMessage(error) : null} />
      </div>

      <ConfirmDialog
        open={reopening}
        onOpenChange={setReopening}
        title="Reopen this attempt?"
        description="The score is removed until the attempt is approved again. If results are released, the student sees it as under review."
        confirmLabel="Reopen"
        reason={{ label: "Reason (kept in the audit log)", required: true }}
        onConfirm={async (reason) => done(await api.grading.reopen(a.attemptId, reason))}
      />
    </>
  );
}

function QuestionCard({
  n,
  q,
  draft,
  readOnly,
  onChange,
}: {
  n: number;
  q: GradingQuestion;
  draft: Draft;
  readOnly: boolean;
  onChange: (patch: Partial<Draft>) => void;
}) {
  const essay = q.type === "ESSAY";
  const [overriding, setOverriding] = useState(isOverride(q, draft));
  const problem = draftProblem(q, draft);

  return (
    <Card>
      <p className="mb-1 flex flex-wrap items-center gap-2 text-xs text-slate-600">
        <span className="font-bold text-slate-700">Q{n}</span>
        <Badge>{QUESTION_TYPE_LABEL[q.type]}</Badge>
        <span>
          {q.points} point{q.points === 1 ? "" : "s"}
        </span>
      </p>
      <p className="font-medium whitespace-pre-wrap text-slate-800">{q.text}</p>
      {q.imageUrl && <img src={q.imageUrl} alt="" referrerPolicy="no-referrer" className="mt-2 max-h-40 rounded" />}

      {essay ? (
        <div className="mt-3 grid gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <p className="mb-1 text-xs font-semibold text-slate-600 uppercase">Student's answer</p>
            {q.answered ? (
              // Plain text only: the answer is never rendered as HTML.
              <div className="max-h-96 overflow-y-auto rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm whitespace-pre-wrap text-slate-800">
                {q.answerText}
              </div>
            ) : (
              <p className="rounded-lg border border-dashed border-slate-300 p-3 text-sm text-slate-600">
                Not answered: counts as 0 points.
              </p>
            )}
          </div>
          {q.guidance && (
            <div>
              <p className="mb-1 text-xs font-semibold text-slate-600 uppercase">Guidance for graders</p>
              <p className="rounded-lg bg-sky-50 p-3 text-sm whitespace-pre-wrap text-sky-900">{q.guidance}</p>
            </div>
          )}
        </div>
      ) : (
        <ul className="mt-3 space-y-1 text-sm">
          {q.options.map((o) => (
            <li
              key={o.id}
              className={cx(
                "flex flex-wrap items-center gap-2 rounded px-2 py-1",
                o.selected && (o.isCorrect ? "bg-emerald-50" : "bg-red-50"),
              )}
            >
              <span className={o.isCorrect ? "font-semibold text-emerald-700" : "text-slate-700"}>
                {o.isCorrect ? "✓" : "○"} {o.text}
              </span>
              {o.isCorrect && <span className="sr-only">(correct)</span>}
              {o.selected && <Badge tone={o.isCorrect ? "green" : "red"}>Student's choice</Badge>}
            </li>
          ))}
          {!q.answered && <li className="text-slate-600">Not answered.</li>}
        </ul>
      )}

      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        {essay || overriding ? (
          <TextInput
            label={`Points (0–${q.points})`}
            type="number"
            min={0}
            max={q.points}
            step="0.5"
            disabled={readOnly}
            value={draft.points}
            error={problem ?? undefined}
            onChange={(e) => onChange({ points: e.target.value })}
          />
        ) : (
          <div className="text-sm">
            <p className="font-semibold text-slate-700">Points</p>
            <p className="mt-1 text-slate-800">
              {draft.points} / {q.points} <span className="text-xs text-slate-600">(automatic)</span>
            </p>
            {!readOnly && (
              <button
                type="button"
                className="mt-1 text-xs font-semibold text-teal-700 underline"
                onClick={() => setOverriding(true)}
              >
                Change points
              </button>
            )}
          </div>
        )}
        {!essay && overriding && (
          <div className="sm:col-span-2">
            <TextInput
              label="Reason for the change"
              disabled={readOnly}
              value={draft.reason}
              maxLength={500}
              onChange={(e) => onChange({ reason: e.target.value })}
            />
          </div>
        )}
        {essay && (
          <div className="sm:col-span-2">
            <TextArea
              label="Feedback (optional)"
              hint="Kept with the grade; shown to the student in a later release."
              rows={2}
              maxLength={2000}
              disabled={readOnly}
              value={draft.feedback}
              onChange={(e) => onChange({ feedback: e.target.value })}
            />
          </div>
        )}
      </div>
      {q.gradedBy && (
        <p className="mt-2 text-xs text-slate-600">
          Last graded by {q.gradedBy.fullName}
          {q.gradedAt && ` on ${formatInstant(q.gradedAt)}`}
          {q.overrideReason && ` · reason: ${q.overrideReason}`}
        </p>
      )}
    </Card>
  );
}
