import type { GradingAttempt, GradingQuestion } from "@contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { QueryErrorPage, usePageTitle } from "../../app/pages";
import { ConfirmDialog, LeavePageDialog } from "../../components/Dialog";
import { FormError, TextArea, TextInput } from "../../components/form";
import { useToast } from "../../components/Toast";
import { Badge, Button, Card, Loading, PageHeader } from "../../components/ui";
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
import { useUnsavedChanges } from "../../lib/forms";
import { qk } from "../../lib/query";
import { formatInstant } from "../../lib/time";
import { AttemptBlocks, QuestionBody } from "./AttemptView";
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

  // Leaving with unsaved grading asks first: the browser's prompt for the tab, a dialog in the app.
  const blocker = useUnsavedChanges(dirty);

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
  // "Save and continue" when leaving: saves without updating this page's data, which would remount
  // the grader (it is keyed by version) and drop the navigation that is waiting.
  const saveBeforeLeaving = async () => {
    await api.grading.save(a.attemptId, a.gradingVersion, changes);
    await client.invalidateQueries({ queryKey: qk.grading(a.attemptId), refetchType: "none" });
    await client.invalidateQueries({ queryKey: qk.gradingQueue(a.exam.id) });
  };
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
          <Link to={`/exams/${a.exam.id}/grading`} className="text-sm font-semibold text-brand-700 hover:underline">
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

      <AttemptBlocks
        questions={a.questions}
        cases={a.cases}
        card={(q) => (
          <QuestionCard
            key={q.id}
            q={q}
            draft={drafts[q.id]!}
            readOnly={approved || busy}
            onChange={(patch) => set(q.id, patch)}
          />
        )}
      />

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
              <Button variant="ghost" disabled={busy} onClick={() => void navigate(`/grading/${a.nextUngradedId}`)}>
                Next ungraded →
              </Button>
            )}
          </div>
        </div>
        <FormError message={error && !conflict ? errorMessage(error) : null} />
      </div>

      <LeavePageDialog blocker={blocker} onSave={invalid ? undefined : saveBeforeLeaving} />
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
  q,
  draft,
  readOnly,
  onChange,
}: {
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
      <QuestionBody q={q} />

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
                className="mt-1 text-xs font-semibold text-brand-700 underline"
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
