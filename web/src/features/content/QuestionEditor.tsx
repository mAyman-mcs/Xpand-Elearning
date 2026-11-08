import type { AnswerSize, ExamType, QuestionType, StaffCase, StaffQuestion } from "@contracts";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { Dialog } from "../../components/Dialog";
import { FormError, SelectInput, TextArea, TextInput } from "../../components/form";
import { ImageField, Picture } from "../../components/Picture";
import { Button, cx } from "../../components/ui";
import { api, errorMessage, type OptionInput, type QuestionInput } from "../../lib/api";
import {
  ANSWER_SIZE_LABEL,
  changeType,
  NEW_QUESTION,
  optionLetter,
  QUESTION_TYPE_LABEL,
  questionProblems,
  questionTypesFor,
  uploadUrl,
} from "../../lib/questions";

interface Props {
  examId: string;
  /** Essays are offered only in MCQ + essay exams. */
  examType: ExamType;
  /** Editing an existing question; adding when absent. */
  question?: StaffQuestion;
  /** The exam's cases, to place the question in one. */
  cases: StaffCase[];
  /** Adding: the case and type to start with (e.g. "Add follow-up" on a case). */
  start?: { caseId?: string | null; type?: QuestionType };
  /** Students have taken the exam: wording only. */
  locked: boolean;
  onClose: () => void;
  onSaved: () => Promise<void>;
}

const fromQuestion = (q: StaffQuestion): QuestionInput => ({
  type: q.type,
  text: q.text,
  imageUrl: q.imageUrl,
  imageId: q.imageId,
  imageAlt: q.imageAlt,
  points: q.points,
  guidance: q.guidance,
  answerSize: q.answerSize,
  caseId: q.caseId,
  options: q.options.map((o) => ({
    id: o.id,
    text: o.text,
    isCorrect: o.isCorrect,
    detail: o.detail,
    imageId: o.imageId,
    imageAlt: o.imageAlt,
    explanation: o.explanation,
  })),
});

const blank = (v: string | null | undefined) => v?.trim() || null;

export function QuestionEditor({ examId, examType, question, cases, start, locked, onClose, onSaved }: Props) {
  const [draft, setDraft] = useState<QuestionInput>(() => {
    if (question) return fromQuestion(question);
    const fresh = { ...NEW_QUESTION, caseId: start?.caseId ?? null };
    return start?.type ? changeType(fresh, start.type) : fresh;
  });
  const set = (patch: Partial<QuestionInput>) => setDraft((d) => ({ ...d, ...patch }));
  const setOption = (i: number, patch: Partial<OptionInput>) =>
    setDraft((d) => ({ ...d, options: d.options.map((o, j) => (j === i ? { ...o, ...patch } : o)) }));
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
      const essay = draft.type === "ESSAY";
      const body: QuestionInput = {
        ...draft,
        imageUrl: draft.imageUrl?.trim() || null,
        imageAlt: draft.imageId ? blank(draft.imageAlt) : null,
        guidance: essay ? blank(draft.guidance) : null,
        answerSize: essay ? (draft.answerSize ?? "LONG") : "LONG",
        options: draft.options.map((o) => ({
          ...o,
          text: o.text.trim(),
          detail: blank(o.detail),
          imageAlt: o.imageId ? blank(o.imageAlt) : null,
          explanation: blank(o.explanation),
        })),
      };
      // Locked: the case can't change, so don't send it.
      if (locked) delete body.caseId;
      // New options carry no id; the server replaces the option list as a whole (or, locked, rewords by id).
      return question ? api.questions.update(question.id, body) : api.questions.create(examId, body);
    },
    onSuccess: async () => {
      await onSaved();
      onClose();
    },
  });

  const essay = draft.type === "ESSAY";
  const fixedOptions = draft.type === "TRUE_FALSE" || locked;
  const types = questionTypesFor(examType);
  // An existing question keeps its own type in the list (e.g. after the exam type changed).
  if (!types.includes(draft.type)) types.push(draft.type);
  const inputType = draft.type === "MULTI_CHOICE" ? "checkbox" : "radio";
  const inCase = cases.find((c) => c.id === draft.caseId);
  const pictureOptions = draft.options.some((o) => o.imageId);

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={question ? "Edit question" : inCase ? `Add a question to “${inCase.title}”` : "Add a question"}
      description={
        locked
          ? "Students have taken this exam: you can fix the wording and pictures, not the answers, points or case."
          : undefined
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
          {types.map((t) => (
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
        {cases.length > 0 && (
          <SelectInput
            label="Case"
            value={draft.caseId ?? ""}
            disabled={locked}
            hint="Questions of a case are shown together, under its situation."
            onChange={(e) => set({ caseId: e.target.value || null })}
          >
            <option value="">None (a question on its own)</option>
            {cases.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </SelectInput>
        )}
      </div>
      <TextArea label="Question" required rows={3} value={draft.text} onChange={(e) => set({ text: e.target.value })} />
      <ImageField
        examId={examId}
        label="Picture (optional)"
        imageId={draft.imageId}
        imageAlt={draft.imageAlt}
        onChange={(p) => set(p)}
      />
      {(draft.imageUrl || question?.imageUrl) && (
        <TextInput
          label="Image link (older questions)"
          type="url"
          placeholder="https://…"
          value={draft.imageUrl ?? ""}
          error={imageProblem ?? undefined}
          hint="Outside links show the student's address to that site. Upload the picture instead."
          onChange={(e) => set({ imageUrl: e.target.value || null })}
        />
      )}

      {essay ? (
        <>
          <SelectInput
            label="Answer box"
            value={draft.answerSize ?? "LONG"}
            disabled={locked}
            onChange={(e) => set({ answerSize: e.target.value as AnswerSize })}
          >
            {(Object.keys(ANSWER_SIZE_LABEL) as AnswerSize[]).map((s) => (
              <option key={s} value={s}>
                {ANSWER_SIZE_LABEL[s]}
              </option>
            ))}
          </SelectInput>
          <TextArea
            label="Model answer / guidance for graders (optional)"
            hint="What a good answer contains. Students never see this."
            rows={4}
            maxLength={5000}
            value={draft.guidance ?? ""}
            onChange={(e) => set({ guidance: e.target.value || null })}
          />
        </>
      ) : (
        <fieldset>
          <legend className="mb-2 text-sm font-bold text-slate-800">
            Options{" "}
            <span className="font-normal text-slate-600">
              — mark the correct {draft.type === "MULTI_CHOICE" ? "ones" : "one"}
            </span>
          </legend>
          {inCase && (
            <p className="mb-2 text-xs text-slate-600">
              In a case, options keep this order and their letters, so follow-up questions can refer to “Option A”.
            </p>
          )}
          <ul className="space-y-3">
            {draft.options.map((o, i) => (
              <li key={i} className="rounded-lg border border-slate-200 p-2">
                <div className="flex items-center gap-2">
                  <input
                    type={inputType}
                    name="correct"
                    checked={o.isCorrect}
                    disabled={locked}
                    onChange={() => markCorrect(i)}
                    aria-label={`Option ${optionLetter(i)} is correct`}
                    className="h-4 w-4 accent-emerald-600"
                  />
                  <span aria-hidden="true" className="w-4 text-sm font-bold text-slate-600">
                    {optionLetter(i)}
                  </span>
                  <input
                    value={o.text}
                    readOnly={draft.type === "TRUE_FALSE"}
                    onChange={(e) => setOption(i, { text: e.target.value })}
                    aria-label={`Option ${optionLetter(i)}`}
                    placeholder={o.imageId ? "Text (optional with a picture)" : `Option ${optionLetter(i)}`}
                    className={cx(
                      "min-w-0 flex-1 rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-teal-500",
                      o.isCorrect ? "border-emerald-400 bg-emerald-50" : "border-slate-300",
                    )}
                  />
                  {!fixedOptions && draft.options.length > 2 && (
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={`Remove option ${optionLetter(i)}`}
                      onClick={() => set({ options: draft.options.filter((_, j) => j !== i) })}
                    >
                      ×
                    </Button>
                  )}
                </div>
                {draft.type !== "TRUE_FALSE" && (
                  <details className="mt-2 pl-10" open={!!(o.imageId || o.detail || o.explanation)}>
                    <summary className="cursor-pointer text-xs font-semibold text-teal-700">
                      Picture, second line, explanation
                    </summary>
                    <div className="mt-2 space-y-2">
                      <ImageField
                        compact
                        examId={examId}
                        label="Picture"
                        imageId={o.imageId}
                        imageAlt={o.imageAlt}
                        onChange={(p) => setOption(i, p)}
                      />
                      <TextInput
                        label="Second line (students see it)"
                        maxLength={300}
                        value={o.detail ?? ""}
                        hint="A neutral description. Don't say why it is right or wrong."
                        onChange={(e) => setOption(i, { detail: e.target.value || null })}
                      />
                      <TextInput
                        label="Explanation (staff only)"
                        maxLength={2000}
                        value={o.explanation ?? ""}
                        hint="Why it is right or wrong. Shown to graders, never to students."
                        onChange={(e) => setOption(i, { explanation: e.target.value || null })}
                      />
                    </div>
                  </details>
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
      )}

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
        {draft.imageId ? (
          <div className="mt-2">
            <Picture
              src={uploadUrl(draft.imageId)}
              alt={draft.imageAlt ?? null}
              className="max-h-40"
              zoomable={false}
            />
          </div>
        ) : (
          draft.imageUrl &&
          !imageProblem && (
            <img src={draft.imageUrl} alt="" referrerPolicy="no-referrer" className="mt-2 max-h-40 rounded" />
          )
        )}
        {essay && (
          <div
            className={cx(
              "mt-2 rounded-lg border border-slate-300 bg-slate-50 p-2 text-sm text-slate-500",
              draft.answerSize === "SHORT" ? "h-9" : "h-20",
            )}
          >
            The student types the answer here.
          </div>
        )}
        <ul className={cx("mt-2 gap-2", pictureOptions ? "grid sm:grid-cols-2" : "space-y-1")}>
          {draft.options.map((o, i) => (
            <li key={i} className="flex items-start gap-2 rounded border border-slate-200 p-2 text-sm">
              <span
                className={cx(
                  "mt-0.5 inline-block h-4 w-4 shrink-0 border border-slate-400",
                  draft.type === "MULTI_CHOICE" ? "rounded" : "rounded-full",
                )}
              />
              <span className="font-bold text-slate-600">{optionLetter(i)}</span>
              <span className="min-w-0">
                {o.imageId && (
                  <Picture
                    src={uploadUrl(o.imageId)}
                    alt={o.imageAlt ?? null}
                    className="mb-1 max-h-32"
                    zoomable={false}
                  />
                )}
                <span className="block text-slate-800">{o.text || (o.imageId ? "" : `Option ${optionLetter(i)}`)}</span>
                {o.detail && <span className="block text-xs text-slate-600 italic">{o.detail}</span>}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </Dialog>
  );
}
