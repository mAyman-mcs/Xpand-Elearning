import type { QuestionImportResult, QuestionType, StaffCase, StaffQuestion } from "@contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { useNavigate } from "react-router";
import { ConfirmDialog, Dialog } from "../../components/Dialog";
import { FormError, TextArea, TextInput } from "../../components/form";
import { Picture } from "../../components/Picture";
import { useToast } from "../../components/Toast";
import { Badge, Button, Card, cx, EmptyState, ErrorBanner, Loading } from "../../components/ui";
import { api, errorMessage } from "../../lib/api";
import {
  ANSWER_SIZE_LABEL,
  contentBlocks,
  IMPORT_EXAMPLE,
  moveBlock,
  optionLetter,
  QUESTION_TYPE_LABEL,
  uploadUrl,
} from "../../lib/questions";
import { qk } from "../../lib/query";
import { useExam } from "../exams/ExamLayout";
import { CaseEditor } from "./CaseEditor";
import { QuestionEditor } from "./QuestionEditor";

type Editing = { question: StaffQuestion } | { start: { caseId?: string | null; type?: QuestionType } } | null;

/** "a", "b", "c" for the questions inside a case. */
const part = (i: number) => String.fromCharCode(97 + i);

/** /exams/:id/questions: the exam's cases and questions, with the answer key (staff only). */
export function ExamQuestions() {
  const { exam } = useExam();
  const content = useQuery({ queryKey: qk.questions(exam.id), queryFn: () => api.questions.list(exam.id) });
  const queryClient = useQueryClient();
  const toast = useToast();
  const [editing, setEditing] = useState<Editing>(null);
  const [editingCase, setEditingCase] = useState<StaffCase | "new" | null>(null);
  const [deleting, setDeleting] = useState<StaffQuestion | null>(null);
  const [deletingCase, setDeletingCase] = useState<{ c: StaffCase; count: number } | null>(null);
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
  const { questions, cases, locked, publishProblems } = content.data;
  const totalPoints = questions.reduce((sum, q) => sum + q.points, 0);
  const blocks = contentBlocks(questions, cases);
  const placed = blocks.filter((b) => b.questions.length > 0).length;
  const essays = exam.type === "MCQ_ESSAY";

  /** Swaps a question with its neighbour inside the same case. */
  const moveWithin = (id: string, by: -1 | 1) => {
    const ids = questions.map((q) => q.id);
    const i = ids.indexOf(id);
    const a = ids[i];
    const b = ids[i + by];
    if (a === undefined || b === undefined) return;
    ids[i] = b;
    ids[i + by] = a;
    reorder.mutate(ids);
  };
  /** Moves a whole case (or a question on its own) past its neighbour. */
  const moveWhole = (blockIndex: number, by: -1 | 1) => {
    const ids = moveBlock(blocks, blockIndex, by);
    if (ids) reorder.mutate(ids);
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
            <strong>Locked:</strong> students have taken this exam. You can fix wording and pictures, not answers,
            points or the list of questions and cases. To change more, work on a copy.
          </span>
          <Button size="sm" variant="secondary" onClick={() => setDuplicating(true)}>
            Duplicate exam
          </Button>
        </div>
      )}
      <Card
        title={`Questions (${questions.length}, ${totalPoints} point${totalPoints === 1 ? "" : "s"})`}
        actions={
          <div className="flex flex-wrap gap-2">
            {!locked && (
              <>
                <Button variant="secondary" onClick={() => setImporting(true)}>
                  Import
                </Button>
                <Button variant="secondary" onClick={() => setEditingCase("new")}>
                  Add case
                </Button>
                <Button onClick={() => setEditing({ start: {} })}>Add question</Button>
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
        {!blocks.length ? (
          <EmptyState title="No questions yet">
            Add questions one by one, add a case (a situation with its questions), or import a list.
          </EmptyState>
        ) : (
          <ol className="space-y-3" aria-label="Questions">
            {blocks.map((block, bi) => {
              const n = bi + 1;
              const what = block.case ? "case" : "question";
              const blockMoves = !locked && block.questions.length > 0 && (
                <>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={bi === 0 || reorder.isPending}
                    onClick={() => moveWhole(bi, -1)}
                    aria-label={`Move ${what} ${n} up`}
                  >
                    ↑
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={bi >= placed - 1 || reorder.isPending}
                    onClick={() => moveWhole(bi, 1)}
                    aria-label={`Move ${what} ${n} down`}
                  >
                    ↓
                  </Button>
                </>
              );

              if (!block.case) {
                const q = block.questions[0]!;
                return (
                  <li key={q.id} className="rounded-lg border border-slate-200 p-4">
                    <QuestionRow
                      label={`Q${n}`}
                      q={q}
                      actions={
                        <>
                          {blockMoves}
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => setEditing({ question: q })}
                            aria-label={`Edit question ${n}`}
                          >
                            Edit
                          </Button>
                          {!locked && (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => setDeleting(q)}
                              aria-label={`Delete question ${n}`}
                            >
                              Delete
                            </Button>
                          )}
                        </>
                      }
                    />
                  </li>
                );
              }

              const c = block.case;
              const casePoints = block.questions.reduce((sum, q) => sum + q.points, 0);
              return (
                <li key={c.id} className="rounded-lg border border-teal-200 bg-teal-50/40 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="mb-1 flex flex-wrap items-center gap-2 text-xs text-slate-600">
                        <span className="font-bold text-slate-700">
                          {block.questions.length ? `Q${n}` : "No questions yet"}
                        </span>
                        <Badge tone="teal">Case</Badge>
                        {c.label && <Badge>{c.label}</Badge>}
                        <span>
                          {block.questions.length} question{block.questions.length === 1 ? "" : "s"} · {casePoints}{" "}
                          point{casePoints === 1 ? "" : "s"}
                        </span>
                      </p>
                      <h3 className="font-bold text-slate-800">{c.title}</h3>
                      <p className="mt-1 text-sm whitespace-pre-wrap text-slate-700">{c.situation}</p>
                      {c.hint && (
                        <p className="mt-1 text-sm text-amber-800">
                          <span className="font-semibold">Hint:</span> {c.hint}
                          {!exam.showHints && <span className="text-xs text-slate-600"> (hidden from students)</span>}
                        </p>
                      )}
                      {c.imageId && <Picture src={uploadUrl(c.imageId)} alt={c.imageAlt} className="mt-2 max-h-32" />}
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {blockMoves}
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => setEditingCase(c)}
                        aria-label={`Edit case ${c.title}`}
                      >
                        Edit case
                      </Button>
                      {!locked && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setDeletingCase({ c, count: block.questions.length })}
                          aria-label={`Delete case ${c.title}`}
                        >
                          Delete
                        </Button>
                      )}
                    </div>
                  </div>
                  {block.questions.length > 0 && (
                    <ol className="mt-3 space-y-2" aria-label={`Questions of ${c.title}`}>
                      {block.questions.map((q, qi) => (
                        <li key={q.id} className="rounded-lg border border-slate-200 bg-white p-3">
                          <QuestionRow
                            label={`Q${n}${part(qi)}`}
                            q={q}
                            actions={
                              <>
                                {!locked && (
                                  <>
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      disabled={qi === 0 || reorder.isPending}
                                      onClick={() => moveWithin(q.id, -1)}
                                      aria-label={`Move question ${n}${part(qi)} up`}
                                    >
                                      ↑
                                    </Button>
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      disabled={qi === block.questions.length - 1 || reorder.isPending}
                                      onClick={() => moveWithin(q.id, 1)}
                                      aria-label={`Move question ${n}${part(qi)} down`}
                                    >
                                      ↓
                                    </Button>
                                  </>
                                )}
                                <Button
                                  size="sm"
                                  variant="secondary"
                                  onClick={() => setEditing({ question: q })}
                                  aria-label={`Edit question ${n}${part(qi)}`}
                                >
                                  Edit
                                </Button>
                                {!locked && (
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => setDeleting(q)}
                                    aria-label={`Delete question ${n}${part(qi)}`}
                                  >
                                    Delete
                                  </Button>
                                )}
                              </>
                            }
                          />
                        </li>
                      ))}
                    </ol>
                  )}
                  {!locked && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button size="sm" variant="secondary" onClick={() => setEditing({ start: { caseId: c.id } })}>
                        Add multiple-choice question
                      </Button>
                      {essays && (
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => setEditing({ start: { caseId: c.id, type: "ESSAY" } })}
                        >
                          Add written follow-up
                        </Button>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </Card>

      {editing && (
        <QuestionEditor
          examId={exam.id}
          examType={exam.type}
          question={"question" in editing ? editing.question : undefined}
          start={"start" in editing ? editing.start : undefined}
          cases={cases}
          locked={locked}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            await refresh();
            toast("question" in editing ? "Question saved" : "Question added");
          }}
        />
      )}
      {editingCase && (
        <CaseEditor
          examId={exam.id}
          existing={editingCase === "new" ? undefined : editingCase}
          onClose={() => setEditingCase(null)}
          onSaved={async () => {
            await refresh();
            toast(editingCase === "new" ? "Case added: now add its questions" : "Case saved");
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
      <ConfirmDialog
        open={deletingCase !== null}
        onOpenChange={(o) => !o && setDeletingCase(null)}
        title={`Delete the case “${deletingCase?.c.title ?? ""}”?`}
        description={
          deletingCase?.count
            ? `Its ${deletingCase.count} question${deletingCase.count === 1 ? " is" : "s are"} deleted too.`
            : "It has no questions."
        }
        confirmLabel="Delete case"
        danger
        onConfirm={async () => {
          if (!deletingCase) return;
          await api.cases.remove(deletingCase.c.id);
          await refresh();
          toast("Case deleted");
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

/** One question with its answer key, as the editor lists it. */
function QuestionRow({ label, q, actions }: { label: string; q: StaffQuestion; actions: ReactNode }) {
  const pictureOptions = q.options.some((o) => o.imageId);
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0 flex-1">
        <p className="mb-1 flex flex-wrap items-center gap-2 text-xs text-slate-600">
          <span className="font-bold text-slate-700">{label}</span>
          <Badge>{QUESTION_TYPE_LABEL[q.type]}</Badge>
          {q.type === "ESSAY" && <span>{ANSWER_SIZE_LABEL[q.answerSize]}</span>}
          <span>
            {q.points} point{q.points === 1 ? "" : "s"}
          </span>
        </p>
        <p className="font-medium whitespace-pre-wrap text-slate-800">{q.text}</p>
        {q.imageId ? (
          <Picture src={uploadUrl(q.imageId)} alt={q.imageAlt} className="mt-2 max-h-32" />
        ) : (
          q.imageUrl && <img src={q.imageUrl} alt="" referrerPolicy="no-referrer" className="mt-2 max-h-32 rounded" />
        )}
        {q.type === "ESSAY" && (
          <p className="mt-2 text-sm text-slate-600">
            {q.guidance ? (
              <>
                <span className="font-semibold">Model answer:</span>{" "}
                <span className="whitespace-pre-wrap">{q.guidance}</span>
              </>
            ) : (
              "Written answer, graded by staff."
            )}
          </p>
        )}
        <ul className={cx("mt-2 text-sm", pictureOptions ? "grid gap-2 sm:grid-cols-2" : "space-y-1")}>
          {q.options.map((o, i) => (
            <li key={o.id} className={o.isCorrect ? "font-semibold text-emerald-700" : "text-slate-600"}>
              <span>
                {o.isCorrect ? "✓ " : "○ "}
                {optionLetter(i)}. {o.text}
              </span>
              {o.isCorrect && <span className="sr-only"> (correct)</span>}
              {o.imageId && <Picture src={uploadUrl(o.imageId)} alt={o.imageAlt} className="mt-1 max-h-24" />}
              {o.detail && <span className="block text-xs font-normal text-slate-600 italic">{o.detail}</span>}
              {o.explanation && (
                <span className="block text-xs font-normal text-sky-800">Explanation: {o.explanation}</span>
              )}
            </li>
          ))}
        </ul>
      </div>
      <div className="flex flex-wrap gap-1">{actions}</div>
    </div>
  );
}

type ImportContent = { questions: unknown[]; cases: unknown[] };

/** A plain list of questions, or { "questions": [...], "cases": [...] }; null when it is neither. */
export function parseImport(text: string): ImportContent | null {
  try {
    const value: unknown = JSON.parse(text);
    if (Array.isArray(value)) return { questions: value, cases: [] };
    if (!value || typeof value !== "object") return null;
    const { questions = [], cases = [] } = value as { questions?: unknown; cases?: unknown };
    return Array.isArray(questions) && Array.isArray(cases) ? { questions, cases } : null;
  } catch {
    return null;
  }
}

/** How many questions an import holds (loose ones and those inside cases). */
export const importCount = (c: ImportContent) =>
  c.questions.length +
  c.cases.reduce<number>((n, item) => {
    const qs = (item as { questions?: unknown } | null)?.questions;
    return n + (Array.isArray(qs) ? qs.length : 0);
  }, 0);

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

  const parse = (): ImportContent | null => {
    const content = parseImport(text);
    if (!content) {
      setParseError("This isn't valid JSON: it must be a list of questions, or { questions, cases } like the example.");
      return null;
    }
    setParseError(null);
    setCount(importCount(content));
    return content;
  };
  const run = useMutation({
    mutationFn: ({ content, dryRun }: { content: ImportContent; dryRun: boolean }) =>
      api.questions.import(examId, content, dryRun),
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
      description="Paste JSON questions and cases (or load a .json file). Nothing is added until everything is valid."
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
                const content = parse();
                if (content) run.mutate({ content, dryRun: false });
              }}
            >
              Import {count} question{count === 1 ? "" : "s"}
            </Button>
          ) : (
            <Button
              busy={run.isPending}
              disabled={!text.trim()}
              onClick={() => {
                const content = parse();
                if (content) run.mutate({ content, dryRun: true });
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
        label="Questions and cases (JSON)"
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
        <p className="mt-1 text-xs text-slate-600">
          type: SINGLE_CHOICE, MULTI_CHOICE, TRUE_FALSE or ESSAY · points defaults to 1 · answerSize (essays): SHORT or
          LONG · a plain list of questions also works. For pictures, upload them in the editor first, then use their
          imageId with an imageAlt.
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
      description="Creates a draft copy with the same settings, tags, cases, questions and materials. It has no assignments and no attempts, so everything can be edited."
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
