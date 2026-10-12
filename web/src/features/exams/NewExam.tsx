import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate } from "react-router";
import { usePermissions } from "../../app/auth";
import { usePageTitle } from "../../app/pages";
import { FormError } from "../../components/form";
import { Button, ButtonLink, Card, PageHeader } from "../../components/ui";
import { api } from "../../lib/api";
import { applyServerErrors } from "../../lib/forms";
import { qk } from "../../lib/query";
import { useCategories, useTags } from "../catalog/queries";
import { ExamFields, NEW_EXAM, useExamForm, type ExamValues } from "./ExamForm";
import { editableCategories } from "./permissions";

export function NewExam() {
  usePageTitle("New exam");
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: perms } = usePermissions();
  const categories = useCategories();
  const tags = useTags();
  const form = useExamForm(NEW_EXAM);
  const [formError, setFormError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: (v: ExamValues) => api.exams.create(v),
    onSuccess: async (exam) => {
      await queryClient.invalidateQueries({ queryKey: qk.exams });
      await queryClient.invalidateQueries({ queryKey: qk.categories });
      void navigate(`/exams/${exam.id}`);
    },
    onError: (e) =>
      setFormError(
        applyServerErrors(
          e,
          form.setError,
          [
            "code",
            "title",
            "categoryId",
            "tagIds",
            "durationMinutes",
            "passMark",
            "weight",
            "maxAttempts",
            "strikeLimit",
            "questionsPerAttempt",
          ],
          {
            CONFLICT: "That code is already used by another exam.",
            FORBIDDEN: "You can't create exams in that category.",
          },
        ),
      ),
  });

  return (
    <>
      <PageHeader title="New exam" description="New exams start as drafts: students never see a draft." />
      <Card>
        <form
          noValidate
          onSubmit={(e) => {
            setFormError(null);
            void form.handleSubmit((v) => create.mutate(v))(e);
          }}
          className="space-y-6"
        >
          <FormError message={formError} />
          <ExamFields
            form={form}
            mode="create"
            categories={editableCategories(perms, categories.data ?? [])}
            tags={tags.data ?? []}
            readOnly={false}
          />
          <div className="flex justify-end gap-2">
            <ButtonLink to="/exams" variant="secondary">
              Cancel
            </ButtonLink>
            <Button type="submit" busy={create.isPending}>
              Create exam
            </Button>
          </div>
        </form>
      </Card>
    </>
  );
}
