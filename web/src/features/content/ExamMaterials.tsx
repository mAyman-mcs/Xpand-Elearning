import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card } from "../../components/ui";
import { api } from "../../lib/api";
import { qk } from "../../lib/query";
import { useExam } from "../exams/ExamLayout";
import { LinkEditor } from "./LinkEditor";

/** /exams/:id/materials: training material links shown to assigned students (view / download). */
export function ExamMaterials() {
  const { exam } = useExam();
  const materials = useQuery({ queryKey: qk.materials(exam.id), queryFn: () => api.materials.list(exam.id) });
  const queryClient = useQueryClient();

  return (
    <Card title="Training material">
      <p className="mb-4 text-sm text-slate-600">
        Students the exam is assigned to see these links (Google Docs, PDFs, slides). Use links that students can open.
        Links for every exam of “{exam.category.name}” go on the Materials page.
      </p>
      <LinkEditor
        caption="Materials"
        rows={materials.data}
        loading={materials.isPending}
        error={materials.error}
        canEdit
        onAdd={(input) => api.materials.create(exam.id, input)}
        onChanged={() => queryClient.invalidateQueries({ queryKey: qk.materials(exam.id) })}
      />
    </Card>
  );
}
