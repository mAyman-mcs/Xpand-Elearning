import type { QuestionImportResult, StaffQuestion } from "@contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate } from "react-router";
import { ConfirmDialog, Dialog } from "../../components/Dialog";
import { FormError, TextArea, TextInput } from "../../components/form";
import { useToast } from "../../components/Toast";
import { Badge, Button, Card, EmptyState, ErrorBanner, Loading } from "../../components/ui";
import { api, errorMessage } from "../../lib/api";
import { IMPORT_EXAMPLE, QUESTION_TYPE_LABEL } from "../../lib/questions";
import { qk } from "../../lib/query";
import { useExam } from "../exams/ExamLayout";
import { QuestionEditor } from "./QuestionEditor";

/** /exams/:id/questions: the question bank of one exam, with the answer key (staff only). */
export function ExamQuestions() {
  const { exam } = useExam();
  const content = useQuery({ queryKey: qk.questions(exam.id), queryFn: () => api.questions.list(exam.id) });
  const queryClient = useQueryClient();
  const toast = useToast();
  const [editing, setEditing] = useState<StaffQuestion | "new" | null>(null);
  const [deleting, setDeleting] = useState<StaffQuestion | null>(null);
  const [importing, setImporting] = useState(false);
  const [duplicating, setDuplicating] = useState(false);

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: qk.questions(exam.id) });
  };
  const reorder = useMutation({
    mutationFn: (ids: string[]) => api.questions.reorder(exam.id, ids),
    onSuccess: refresh,
    onError: (e) => toast(errorMessage(e), "error"),
  });

  if (content.isPending) return <Loading />;
  if (content.error) return <ErrorBanner error={content.error} onRetry={() => void content.refetch()} />;
  const { questions, locked, publishProblems } = content.data;
  const totalPoints = questions.reduce((sum, q) => sum + q.points, 0);

  const move = (index: number, by: -1 | 1) => {
    const ids = questions.map((q) => q.id);
    const target = index + by;
    const a = ids[index];
    const b = ids[target];
    if (a === undefined || b === undefined) return;
    ids[index] = b;
    ids[target] = a;
    reorder.mutate(ids);
  };

  if (exam.isExternal)
    return (
      <Card>
        <EmptyState title="External exam">
          Taken outside the platform: it has no questions. Staff enter the scores.
        </EmptyState>
      </Card>
    );

  return (
    <div className="space-y-6">
      {locked && (
        <div
          role="status"
          className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"
        >
          <span>
            <strong>Locked:</strong> students have taken this exam. You can fix wording, not answers, points or the list
            of questions. To change more, work on a copy.
          </span>
          <Button size="sm" variant="secondary" onClick={() => setDuplicating(true)}>
            Duplicate exam
          </Button>
        </div>
      )}
      <Card
        title={`Questions (${questions.length}, ${totalPoints} point${totalPoints === 1 ? "" : "s"})`}
        actions={
          <div className="flex gap-2">
            {!locked && (
              <>
                <Button variant="secondary" onClick={() => setImporting(true)}>
                  Import
                </Button>
                <Button onClick={() => setEditing("new")}>Add question</Button>
              </>
            )}
            {!locked && (
              <Button variant="ghost" onClick={() => setDuplicating(true)}>
                Duplicate exam
              </Button>
            )}
          </div>
        }
      >
        <div
          aria-live="polite"
          className={
            publishProblems.length
              ? "mb-4 rounded-lg bg-slate-50 p-3 text-sm"
              : "mb-4 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800"
          }
        >
          {publishProblems.length ? (
            <>
              <p className="font-semibold text-slate-700">Before it can be published:</p>
              <ul className="mt-1 list-disc pl-5 text-slate-600">
                {publishProblems.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            </>
          ) : (
            "Ready to publish."
          )}
        </div>
        {!questions.length ? (
          <EmptyState title="No questions yet">Add them one by one, or import a list.</EmptyState>
        ) : (
          <ol className="space-y-3" aria-label="Questions">
            {questions.map((q, i) => (
              <li key={q.id} className="rounded-lg border border-slate-200 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="mb-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                      <span className="font-bold text-slate-700">Q{i + 1}</span>
                      <Badge>{QUESTION_TYPE_LABEL[q.type]}</Badge>
                      <span>
                        {q.points} point{q.points === 1 ? "" : "s"}
                      </span>
                    </p>
                    <p className="font-medium whitespace-pre-wrap text-slate-800">{q.text}</p>
                    {q.imageUrl && <img src={q.imageUrl} alt="" className="mt-2 max-h-32 rounded" />}
                    <ul className="mt-2 space-y-1 text-sm">
                      {q.options.map((o) => (
                        <li key={o.id} className={o.isCorrect ? "font-semibold text-emerald-700" : "text-slate-600"}>
                          {o.isCorrect ? "✓ " : "○ "}
                          {o.text}
                          {o.isCorrect && <span className="sr-only"> (correct)</span>}
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {!locked && (
                      <>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={i === 0 || reorder.isPending}
                          onClick={() => move(i, -1)}
                          aria-label={`Move question ${i + 1} up`}
                        >
                          ↑
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={i === questions.length - 1 || reorder.isPending}
                          onClick={() => move(i, 1)}
                          aria-label={`Move question ${i + 1} down`}
                        >
                          ↓
                        </Button>
                      </>
                    )}
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => setEditing(q)}
                      aria-label={`Edit question ${i + 1}`}
                    >
                      Edit
                    </Button>
                    {!locked && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setDeleting(q)}
                        aria-label={`Delete question ${i + 1}`}
                      >
                        Delete
                      </Button>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ol>
        )}
      </Card>

      {editing && (
        <QuestionEditor
          examId={exam.id}
          question={editing === "new" ? undefined : editing}
          locked={locked}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            await refresh();
            toast(editing === "new" ? "Question added" : "Question saved");
          }}
        />
      )}
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Delete this question?"
        description={deleting?.text ?? ""}
        confirmLabel="Delete question"
        danger
        onConfirm={async () => {
          if (!deleting) return;
          await api.questions.remove(deleting.id);
          await refresh();
          toast("Question deleted");
        }}
      />
      {importing && (
        <ImportDialog
          examId={exam.id}
          onClose={() => setImporting(false)}
          onImported={async (n) => {
            await refresh();
            toast(`${n} question${n === 1 ? "" : "s"} imported`);
          }}
        />
      )}
      {duplicating && <DuplicateDialog examId={exam.id} title={exam.title} onClose={() => setDuplicating(false)} />}
    </div>
  );
}

function ImportDialog({
  examId,
  onClose,
  onImported,
}: {
  examId: string;
  onClose: () => void;
  onImported: (n: number) => Promise<void>;
}) {
  const [text, setText] = useState("");
  const [parseError, setParseError] = useState<string | null>(null);
  const [check, setCheck] = useState<QuestionImportResult | null>(null);
  const [count, setCount] = useState(0);

  const parse = (): unknown[] | null => {
    try {
      const value: unknown = JSON.parse(text);
      if (!Array.isArray(value)) throw new Error("not a list");
      setParseError(null);
      setCount(value.length);
      return value as unknown[];
    } catch {
      setParseError("This isn't valid JSON: it must be a list [ … ] of questions, like the example.");
      return null;
    }
  };
  const run = useMutation({
    mutationFn: ({ questions, dryRun }: { questions: unknown[]; dryRun: boolean }) =>
      api.questions.import(examId, questions, dryRun),
    onSuccess: async (res) => {
      if (!res.dryRun && res.imported) {
        await onImported(res.imported);
        onClose();
      } else setCheck(res);
    },
  });
  const ready = check && check.dryRun && !check.errors.length;

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Import questions"
      description="Paste a JSON list of questions (or load a .json file). Nothing is added until every question is valid."
      wide
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          {ready ? (
            <Button
              busy={run.isPending}
              onClick={() => {
                const q = parse();
                if (q) run.mutate({ questions: q, dryRun: false });
              }}
            >
              Import {count} question{count === 1 ? "" : "s"}
            </Button>
          ) : (
            <Button
              busy={run.isPending}
              disabled={!text.trim()}
              onClick={() => {
                const q = parse();
                if (q) run.mutate({ questions: q, dryRun: true });
              }}
            >
              Check
            </Button>
          )}
        </>
      }
    >
      <label className="block text-sm font-semibold text-slate-700">
        JSON file (optional)
        <input
          type="file"
          accept=".json,application/json"
          className="mt-1 block text-sm"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file)
              void file.text().then((t) => {
                setText(t);
                setCheck(null);
              });
          }}
        />
      </label>
      <TextArea
        label="Questions (JSON)"
        rows={10}
        className="font-mono text-xs"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setCheck(null);
        }}
      />
      <details className="text-sm">
        <summary className="cursor-pointer text-teal-700">Show the format</summary>
        <pre className="mt-2 max-h-56 overflow-auto rounded bg-slate-50 p-2 text-xs">{IMPORT_EXAMPLE}</pre>
        <p className="mt-1 text-xs text-slate-500">
          type: SINGLE_CHOICE, MULTI_CHOICE or TRUE_FALSE · points defaults to 1 · imageUrl (optional) must be https.
        </p>
      </details>
      <FormError message={parseError ?? (run.error ? errorMessage(run.error) : null)} />
      {check && check.errors.length > 0 && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          <p className="font-semibold">Nothing was imported. Fix these first:</p>
          <ul className="mt-1 list-disc pl-5">
            {check.errors.map((e, i) => (
              <li key={i}>
                {e.index ? `Question ${e.index}: ` : ""}
                {e.message}
              </li>
            ))}
          </ul>
        </div>
      )}
      {ready && <p className="text-sm font-semibold text-emerald-700">All questions are valid.</p>}
    </Dialog>
  );
}

function DuplicateDialog({ examId, title, onClose }: { examId: string; title: string; onClose: () => void }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [code, setCode] = useState("");
  const [newTitle, setNewTitle] = useState(`${title} (copy)`);
  const duplicate = useMutation({
    mutationFn: () => api.exams.duplicate(examId, code, newTitle.trim() || undefined),
    onSuccess: async (copy) => {
      await queryClient.invalidateQueries({ queryKey: qk.exams });
      toast("Copy created as a draft");
      onClose();
      void navigate(`/exams/${copy.id}/questions`);
    },
  });
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Duplicate exam"
      description="Creates a draft copy with the same settings, tags, questions and materials. It has no assignments and no attempts, so everything can be edited."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            busy={duplicate.isPending}
            disabled={!/^[A-Za-z0-9][A-Za-z0-9-]{1,30}$/.test(code.trim())}
            onClick={() => duplicate.mutate()}
          >
            Create copy
          </Button>
        </>
      }
    >
      <TextInput
        label="Code of the copy"
        required
        value={code}
        onChange={(e) => setCode(e.target.value)}
        hint="2–31 characters: letters, digits and dashes."
      />
      <TextInput label="Title of the copy" value={newTitle} onChange={(e) => setNewTitle(e.target.value)} />
      <FormError message={duplicate.error ? errorMessage(duplicate.error) : null} />
    </Dialog>
  );
}
