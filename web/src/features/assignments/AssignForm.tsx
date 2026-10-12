import type { PreviewRow } from "@contracts";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { FormError } from "../../components/form";
import { Button } from "../../components/ui";
import { api, ApiError, errorMessage, type BulkInput, type ExamSelection } from "../../lib/api";
import { qk } from "../../lib/query";
import { EMPTY_SCHEDULE, toScheduleInput, type ScheduleDraft } from "../../lib/schedule";
import { PreviewTable, ScheduleFields, TargetPicker, toTargetInputs, type Targets } from "./components";

/** The server's all-or-nothing refusals, in words. */
function assignError(e: unknown): string {
  if (e instanceof ApiError && e.code === "CONFLICT")
    return "Some of these are already assigned to the same target. Edit the existing assignment instead; nothing was saved.";
  if (e instanceof ApiError && e.code === "FORBIDDEN" && Array.isArray(e.details))
    return `You may not assign ${e.details.length} of these exam × target pairs (outside your access). Nothing was saved.`;
  return errorMessage(e);
}

interface Props {
  /** Which exams: fixed by the exam page, or chosen on the bulk page. Null while not chosen yet. */
  selection: ExamSelection | null;
  /** Extra fields above (the bulk page's exam chooser). */
  children?: ReactNode;
  showExamInPreview?: boolean;
  onAssigned: (created: number) => void;
  onCancel?: () => void;
}

/** Who + when → preview (what every student will see) → assign, all or nothing. */
export function AssignForm({ selection, children, showExamInPreview, onAssigned, onCancel }: Props) {
  const queryClient = useQueryClient();
  const [targets, setTargets] = useState<Targets>({ groupIds: [], people: [] });
  const [draft, setDraft] = useState<ScheduleDraft>(EMPTY_SCHEDULE);
  // A preview is valid only for exactly the request it was made for: any change (here or in the
  // parent's exam choice) hides it, so what is assigned is always what was previewed.
  const [preview, setPreview] = useState<{ key: string; rows: PreviewRow[] } | null>(null);

  const schedule = toScheduleInput(draft);
  const targetInputs = toTargetInputs(targets);
  const problems = [
    ...(selection ? [] : ["Choose the exams."]),
    ...(targetInputs.length ? [] : ["Choose at least one group or student."]),
    ...("problems" in schedule ? schedule.problems : []),
  ];
  const body: BulkInput | null =
    selection && "schedule" in schedule && targetInputs.length
      ? { ...selection, targets: targetInputs, schedule: schedule.schedule }
      : null;

  const bodyKey = JSON.stringify(body);
  const rows = preview?.key === bodyKey ? preview.rows : null;

  const previewMutation = useMutation({
    mutationFn: (b: BulkInput) => api.assignments.preview(b),
    onSuccess: (result, b) => setPreview({ key: JSON.stringify(b), rows: result }),
  });
  const assign = useMutation({
    mutationFn: (b: BulkInput) => api.assignments.bulk(b),
    onSuccess: async (res) => {
      await queryClient.invalidateQueries({ queryKey: ["assignments"] });
      await queryClient.invalidateQueries({ queryKey: ["availability"] });
      await queryClient.invalidateQueries({ queryKey: qk.stats });
      onAssigned(res.created);
    },
  });

  return (
    <div className="space-y-6">
      {children}
      <TargetPicker value={targets} onChange={setTargets} />
      <ScheduleFields draft={draft} onChange={setDraft} />

      {problems.length > 0 && (
        <ul className="list-disc rounded-lg bg-slate-50 p-3 pl-8 text-sm text-slate-600" aria-live="polite">
          {problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
      {/* Errors belong to the request that caused them. */}
      <FormError
        message={
          previewMutation.error && JSON.stringify(previewMutation.variables) === bodyKey
            ? assignError(previewMutation.error)
            : assign.error && JSON.stringify(assign.variables) === bodyKey
              ? assignError(assign.error)
              : null
        }
      />

      {rows && (
        <section aria-label="Preview" className="space-y-2">
          <h3 className="text-sm font-bold text-slate-800">
            Preview: {rows.length} student window{rows.length === 1 ? "" : "s"}
          </h3>
          <PreviewTable rows={rows} showExam={showExamInPreview} />
        </section>
      )}

      <div className="flex flex-wrap justify-end gap-2">
        {onCancel && (
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
        )}
        {!rows ? (
          <Button
            busy={previewMutation.isPending}
            disabled={!body}
            onClick={() => body && previewMutation.mutate(body)}
          >
            Preview
          </Button>
        ) : (
          <Button busy={assign.isPending} onClick={() => body && assign.mutate(body)}>
            Assign
          </Button>
        )}
      </div>
    </div>
  );
}
