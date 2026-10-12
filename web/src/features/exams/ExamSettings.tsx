import type { Exam, ExamStatus } from "@contracts";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { usePermissions } from "../../app/auth";
import { ConfirmDialog } from "../../components/Dialog";
import { FormError } from "../../components/form";
import { useToast } from "../../components/Toast";
import { Badge, Button, Card } from "../../components/ui";
import { api, type ExamPatch } from "../../lib/api";
import { applyServerErrors } from "../../lib/forms";
import { EXAM_STATUS } from "../../lib/labels";
import { qk } from "../../lib/query";
import { formatInstant } from "../../lib/time";
import { useCategories, useTags } from "../catalog/queries";
import { ExamFields, useExamForm, valuesOf, type ExamValues } from "./ExamForm";
import { useExam } from "./ExamLayout";
import { editableCategories } from "./permissions";

const SETTINGS = [
  "title",
  "durationMinutes",
  "passMark",
  "weight",
  "maxAttempts",
  "strikeLimit",
  "questionsPerAttempt",
  "isExternal",
  "allowBackNavigation",
  "shuffleQuestions",
  "shuffleOptions",
  "requireFullscreen",
] as const;

/** The changed settings only (omitted fields keep their value on the server). */
function patchOf(before: ExamValues, after: ExamValues): ExamPatch {
  const patch: Record<string, unknown> = {};
  for (const key of SETTINGS) if (before[key] !== after[key]) patch[key] = after[key];
  if (before.categoryId !== after.categoryId) patch.categoryId = after.categoryId;
  return patch as ExamPatch;
}

const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));

export function ExamSettings() {
  const { exam, allowed } = useExam();
  const canEdit = allowed("EXAM_EDIT");
  const { data: perms } = usePermissions();
  const categories = useCategories(true);
  const tags = useTags();
  const queryClient = useQueryClient();
  const toast = useToast();
  const before = valuesOf(exam);
  const form = useExamForm(before);
  const [formError, setFormError] = useState<string | null>(null);
  const [pendingMove, setPendingMove] = useState<ExamValues | null>(null);

  const updated = async (next: Exam) => {
    queryClient.setQueryData(qk.exam(exam.id), next);
    await queryClient.invalidateQueries({ queryKey: qk.exams });
    await queryClient.invalidateQueries({ queryKey: qk.categories });
  };

  const save = useMutation({
    mutationFn: async (v: ExamValues) => {
      const patch = patchOf(before, v);
      let next = exam;
      if (Object.keys(patch).length) next = await api.exams.update(exam.id, patch);
      if (!sameSet(before.tagIds, v.tagIds)) next = await api.exams.setTags(exam.id, v.tagIds);
      return next;
    },
    onSuccess: async (next) => {
      await updated(next);
      toast("Exam saved");
    },
    onError: (e) =>
      setFormError(
        applyServerErrors(e, form.setError, [...SETTINGS, "categoryId", "tagIds"], {
          FORBIDDEN: "You can't move the exam to that category.",
        }),
      ),
  });

  // The current category stays selectable even when archived or outside the caller's edit scope.
  const choices = editableCategories(
    perms,
    (categories.data ?? []).filter((c) => !c.archived || c.id === exam.category.id),
  );
  const categoryOptions = choices.some((c) => c.id === exam.category.id)
    ? choices
    : [
        { id: exam.category.id, name: exam.category.name, slug: exam.category.slug, position: 0, archived: false },
        ...choices,
      ];

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <Card title="Settings" className="lg:col-span-2">
        {!canEdit && (
          <p className="mb-4 rounded-lg bg-slate-50 p-3 text-sm text-slate-600">
            Read only: editing this exam needs the “Edit exams and questions” permission on it.
          </p>
        )}
        <form
          noValidate
          onSubmit={(e) => {
            setFormError(null);
            void form.handleSubmit((v) => (v.categoryId !== before.categoryId ? setPendingMove(v) : save.mutate(v)))(e);
          }}
          className="space-y-6"
        >
          <FormError message={formError} />
          <ExamFields form={form} mode="edit" categories={categoryOptions} tags={tags.data ?? []} readOnly={!canEdit} />
          {canEdit && (
            <div className="flex justify-end">
              <Button type="submit" busy={save.isPending} disabled={!form.formState.isDirty}>
                Save changes
              </Button>
            </div>
          )}
        </form>
        <ConfirmDialog
          open={pendingMove !== null}
          onOpenChange={(o) => !o && setPendingMove(null)}
          title="Move to another category?"
          description="Instructors whose access is by category gain or lose this exam. Their access changes from their next click."
          confirmLabel="Move and save"
          onConfirm={() => (pendingMove ? save.mutateAsync(pendingMove) : Promise.resolve())}
        />
      </Card>
      <StatusCard exam={exam} canEdit={canEdit} onChanged={updated} />
    </div>
  );
}

const TRANSITIONS: Record<ExamStatus, { to: ExamStatus; label: string; danger?: boolean; explain: string }[]> = {
  DRAFT: [
    { to: "PUBLISHED", label: "Publish", explain: "Students it is assigned to will see it (opening by its schedule)." },
    {
      to: "ARCHIVED",
      label: "Archive",
      danger: true,
      explain: "It can no longer be assigned; students who had it see it as closed.",
    },
  ],
  PUBLISHED: [
    { to: "DRAFT", label: "Back to draft", explain: "Students stop seeing it until it is published again." },
    {
      to: "ARCHIVED",
      label: "Archive",
      danger: true,
      explain: "It can no longer be assigned; students see it as closed.",
    },
  ],
  ARCHIVED: [
    {
      to: "DRAFT",
      label: "Restore as draft",
      explain: "It becomes editable and assignable again, hidden from students.",
    },
  ],
};

function StatusCard({
  exam,
  canEdit,
  onChanged,
}: {
  exam: Exam;
  canEdit: boolean;
  onChanged: (e: Exam) => Promise<void>;
}) {
  const toast = useToast();
  const [target, setTarget] = useState<(typeof TRANSITIONS)[ExamStatus][number] | null>(null);
  const change = useMutation({
    mutationFn: (status: ExamStatus) => api.exams.update(exam.id, { status }),
    onSuccess: async (next) => {
      await onChanged(next);
      toast(`Exam is now ${EXAM_STATUS[next.status].label.toLowerCase()}`);
    },
  });

  return (
    <Card title="Status">
      <p className="mb-1">
        <Badge tone={EXAM_STATUS[exam.status].tone}>{EXAM_STATUS[exam.status].label}</Badge>
      </p>
      <p className="mb-4 text-xs text-slate-500">Last changed {formatInstant(exam.updatedAt)}</p>
      {canEdit && (
        <div className="flex flex-col gap-2">
          {TRANSITIONS[exam.status].map((t) => (
            <Button
              key={t.to}
              variant={t.danger ? "danger" : t.to === "PUBLISHED" ? "primary" : "secondary"}
              onClick={() => setTarget(t)}
            >
              {t.label}
            </Button>
          ))}
        </div>
      )}
      <ConfirmDialog
        open={target !== null}
        onOpenChange={(o) => !o && setTarget(null)}
        title={`${target?.label ?? ""}?`}
        description={target?.explain ?? ""}
        confirmLabel={target?.label ?? ""}
        danger={target?.danger}
        onConfirm={() => (target ? change.mutateAsync(target.to) : Promise.resolve())}
      />
    </Card>
  );
}
