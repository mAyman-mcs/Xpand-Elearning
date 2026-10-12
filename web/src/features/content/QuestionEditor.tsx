import type { QuestionType, StaffQuestion } from "@contracts";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { Dialog } from "../../components/Dialog";
import { FormError, SelectInput, TextArea, TextInput } from "../../components/form";
import { Button, cx } from "../../components/ui";
import { api, errorMessage, type QuestionInput } from "../../lib/api";
import { changeType, NEW_QUESTION, QUESTION_TYPE_LABEL, questionProblems } from "../../lib/questions";

interface Props {
  examId: string;
  /** Editing an existing question; adding when absent. */
  question?: StaffQuestion;
  /** Students have taken the exam: wording only. */
  locked: boolean;
  onClose: () => void;
  onSaved: () => Promise<void>;
}

const fromQuestion = (q: StaffQuestion): QuestionInput => ({
  type: q.type,
  text: q.text,
  imageUrl: q.imageUrl,
  points: q.points,
  options: q.options.map((o) => ({ id: o.id, text: o.text, isCorrect: o.isCorrect })),
});

export function QuestionEditor({ examId, question, locked, onClose, onSaved }: Props) {
  const [draft, setDraft] = useState<QuestionInput>(() => (question ? fromQuestion(question) : NEW_QUESTION));
  const set = (patch: Partial<QuestionInput>) => setDraft((d) => ({ ...d, ...patch }));
  const setOption = (i: number, patch: Partial<QuestionInput["options"][number]>) =>
    set({ options: draft.options.map((o, j) => (j === i ? { ...o, ...patch } : o)) });
  const markCorrect = (i: number) =>
    set({
      options: draft.options.map((o, j) =>
        draft.type === "MULTI_CHOICE"
          ? j === i
            ? { ...o, isCorrect: !o.isCorrect }
            : o
          : { ...o, isCorrect: j === i },
      ),
    });

  const problems = questionProblems(draft);
  const imageProblem =
    draft.imageUrl && !/^https:\/\/\S+$/.test(draft.imageUrl) ? "The image link must start with https://" : null;
  const save = useMutation({
    mutationFn: () => {
      const body = { ...draft, imageUrl: draft.imageUrl?.trim() || null };
      // New options carry no id; the server replaces the option list as a whole (or, locked, rewords by id).
      return question ? api.questions.update(question.id, body) : api.questions.create(examId, body);
    },
    onSuccess: async () => {
      await onSaved();
      onClose();
    },
  });

  const fixedOptions = draft.type === "TRUE_FALSE" || locked;
  const inputType = draft.type === "MULTI_CHOICE" ? "checkbox" : "radio";

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={question ? "Edit question" : "Add a question"}
      description={
        locked ? "Students have taken this exam: you can fix the wording, not the answers or points." : undefined
      }
      wide
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button busy={save.isPending} disabled={problems.length > 0 || !!imageProblem} onClick={() => save.mutate()}>
            {question ? "Save question" : "Add question"}
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-3">
        <SelectInput
          label="Type"
          value={draft.type}
          disabled={locked}
          onChange={(e) => setDraft(changeType(draft, e.target.value as QuestionType))}
        >
          {(Object.keys(QUESTION_TYPE_LABEL) as QuestionType[]).map((t) => (
            <option key={t} value={t}>
              {QUESTION_TYPE_LABEL[t]}
            </option>
          ))}
        </SelectInput>
        <TextInput
          label="Points"
          type="number"
          min={0.5}
          max={100}
          step="0.5"
          disabled={locked}
          value={String(draft.points)}
          onChange={(e) => set({ points: Number(e.target.value) })}
        />
      </div>
      <TextArea label="Question" required rows={3} value={draft.text} onChange={(e) => set({ text: e.target.value })} />
      <TextInput
        label="Image link (optional)"
        type="url"
        placeholder="https://…"
        value={draft.imageUrl ?? ""}
        error={imageProblem ?? undefined}
        onChange={(e) => set({ imageUrl: e.target.value || null })}
      />

      <fieldset>
        <legend className="mb-2 text-sm font-bold text-slate-800">
          Options{" "}
          <span className="font-normal text-slate-600">
            — mark the correct {draft.type === "MULTI_CHOICE" ? "ones" : "one"}
          </span>
        </legend>
        <ul className="space-y-2">
          {draft.options.map((o, i) => (
            <li key={i} className="flex items-center gap-2">
              <input
                type={inputType}
                name="correct"
                checked={o.isCorrect}
                disabled={locked}
                onChange={() => markCorrect(i)}
                aria-label={`Option ${i + 1} is correct`}
                className="h-4 w-4 accent-emerald-600"
              />
              <input
                value={o.text}
                readOnly={draft.type === "TRUE_FALSE"}
                onChange={(e) => setOption(i, { text: e.target.value })}
                aria-label={`Option ${i + 1}`}
                placeholder={`Option ${i + 1}`}
                className={cx(
                  "flex-1 rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-teal-500",
                  o.isCorrect ? "border-emerald-400 bg-emerald-50" : "border-slate-300",
                )}
              />
              {!fixedOptions && draft.options.length > 2 && (
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={`Remove option ${i + 1}`}
                  onClick={() => set({ options: draft.options.filter((_, j) => j !== i) })}
                >
                  ×
                </Button>
              )}
            </li>
          ))}
        </ul>
        {!fixedOptions && draft.options.length < 10 && (
          <Button
            size="sm"
            variant="secondary"
            className="mt-2"
            onClick={() => set({ options: [...draft.options, { text: "", isCorrect: false }] })}
          >
            Add option
          </Button>
        )}
      </fieldset>

      {problems.length > 0 && (
        <ul className="list-disc pl-5 text-sm text-amber-800" aria-live="polite">
          {problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
      <FormError message={save.error ? errorMessage(save.error) : null} />

      <section aria-label="Student preview" className="rounded-lg border border-dashed border-slate-300 p-4">
        <p className="mb-2 text-xs font-semibold text-slate-600 uppercase">What the student sees (answers hidden)</p>
        <p className="font-semibold whitespace-pre-wrap text-slate-800">{draft.text || "…"}</p>
        {draft.imageUrl && !imageProblem && <img src={draft.imageUrl} alt="" className="mt-2 max-h-40 rounded" />}
        <ul className="mt-2 space-y-1">
          {draft.options.map((o, i) => (
            <li key={i} className="flex items-center gap-2 text-sm">
              <span
                className={cx(
                  "inline-block h-4 w-4 border border-slate-400",
                  draft.type === "MULTI_CHOICE" ? "rounded" : "rounded-full",
                )}
              />
              {o.text || `Option ${i + 1}`}
            </li>
          ))}
        </ul>
      </section>
    </Dialog>
  );
}
