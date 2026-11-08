import type { StaffCase } from "@contracts";
import { useMutation } from "@tanstack/react-query";
import { useId, useState } from "react";
import { Dialog } from "../../components/Dialog";
import { FormError, TextArea, TextInput } from "../../components/form";
import { ImageField } from "../../components/Picture";
import { Button } from "../../components/ui";
import { api, errorMessage, type CaseInput } from "../../lib/api";
import { CASE_LABELS } from "../../lib/questions";

const EMPTY: CaseInput = { label: null, title: "", situation: "", hint: null, imageId: null, imageAlt: null };

/**
 * Add or edit a case: the situation shared by a choice question and its written follow-ups
 * (docs/CASE_QUESTIONS_PLAN.md). Cases are wording, so they stay editable after students take the exam.
 */
export function CaseEditor({
  examId,
  existing,
  onClose,
  onSaved,
}: {
  examId: string;
  existing?: StaffCase;
  onClose: () => void;
  onSaved: (saved: StaffCase) => Promise<void>;
}) {
  const [draft, setDraft] = useState<CaseInput>(() => (existing ? { ...existing } : EMPTY));
  const set = (patch: Partial<CaseInput>) => setDraft((d) => ({ ...d, ...patch }));
  const labelsId = useId();
  const missingAlt = !!draft.imageId && !draft.imageAlt?.trim();
  const save = useMutation({
    mutationFn: () => {
      const body: CaseInput = {
        label: draft.label?.trim().toUpperCase() || null,
        title: draft.title.trim(),
        situation: draft.situation.trim(),
        hint: draft.hint?.trim() || null,
        imageId: draft.imageId,
        imageAlt: draft.imageId ? draft.imageAlt?.trim() || null : null,
      };
      return existing ? api.cases.update(existing.id, body) : api.cases.create(examId, body);
    },
    onSuccess: async (saved) => {
      await onSaved(saved);
      onClose();
    },
  });

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={existing ? "Edit case" : "Add a case"}
      description="A case is one situation with its questions: usually a multiple-choice question and written follow-ups. Students see them together on one screen."
      wide
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            busy={save.isPending}
            disabled={!draft.title.trim() || !draft.situation.trim() || missingAlt}
            onClick={() => save.mutate()}
          >
            {existing ? "Save case" : "Add case"}
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="sm:col-span-2">
          <TextInput
            label="Title"
            required
            maxLength={200}
            placeholder="e.g. Linux file permissions"
            value={draft.title}
            onChange={(e) => set({ title: e.target.value })}
          />
        </div>
        <TextInput
          label="Label (optional)"
          maxLength={20}
          list={labelsId}
          placeholder="e.g. DESIGN"
          value={draft.label ?? ""}
          onChange={(e) => set({ label: e.target.value || null })}
        />
        <datalist id={labelsId}>
          {CASE_LABELS.map((l) => (
            <option key={l} value={l} />
          ))}
        </datalist>
      </div>
      <TextArea
        label="Situation"
        required
        rows={5}
        maxLength={5000}
        hint="The story students read before answering this case's questions."
        value={draft.situation}
        onChange={(e) => set({ situation: e.target.value })}
      />
      <TextArea
        label="Hint (optional)"
        rows={2}
        maxLength={1000}
        hint="Shown to students only when the exam setting “Show hints” is on. Graders always see it."
        value={draft.hint ?? ""}
        onChange={(e) => set({ hint: e.target.value || null })}
      />
      <ImageField
        examId={examId}
        label="Picture for the situation (optional)"
        imageId={draft.imageId}
        imageAlt={draft.imageAlt}
        onChange={(p) => set(p)}
      />
      <FormError message={save.error ? errorMessage(save.error) : null} />
    </Dialog>
  );
}
