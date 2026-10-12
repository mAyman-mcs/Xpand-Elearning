import type { Assignment, PreviewRow } from "@contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ConfirmDialog, Dialog } from "../../components/Dialog";
import { FormError } from "../../components/form";
import { Table, type Column } from "../../components/Table";
import { useToast } from "../../components/Toast";
import { Badge, Button, Card } from "../../components/ui";
import { api, errorMessage, type TargetInput } from "../../lib/api";
import { SCHEDULE_MODE } from "../../lib/labels";
import { qk } from "../../lib/query";
import { describeSchedule, draftFromSchedule, toScheduleInput, type ScheduleDraft } from "../../lib/schedule";
import { useExam } from "../exams/ExamLayout";
import { AssignForm } from "./AssignForm";
import { PreviewTable, ScheduleFields } from "./components";

const targetOf = (a: Assignment): TargetInput =>
  a.target.type === "user" ? { userId: a.target.id } : { groupId: a.target.id };

/** /exams/:id/assignments: who the exam is assigned to, and when it opens for them. */
export function ExamAssignments() {
  const { exam, allowed } = useExam();
  const canAssign = allowed("EXAM_ASSIGN");
  const canSchedule = allowed("EXAM_SCHEDULE");
  const assignments = useQuery({ queryKey: qk.assignments(exam.id), queryFn: () => api.assignments.list(exam.id) });
  const queryClient = useQueryClient();
  const toast = useToast();
  const [assigning, setAssigning] = useState(false);
  const [editing, setEditing] = useState<Assignment | null>(null);
  const [removing, setRemoving] = useState<Assignment | null>(null);

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: qk.assignments(exam.id) });
    await queryClient.invalidateQueries({ queryKey: qk.availability(exam.id) });
  };

  const columns: Column<Assignment>[] = [
    {
      header: "Assigned to",
      cell: (a) =>
        a.target.type === "group" ? (
          <span>
            <Badge tone="blue">Group</Badge> <span className="font-semibold">{a.target.name}</span>
          </span>
        ) : (
          <span>
            <Badge tone="teal">Student</Badge> <span className="font-semibold">{a.target.name}</span>{" "}
            <span className="font-mono text-xs text-slate-600">{a.target.username}</span>
          </span>
        ),
    },
    {
      header: "Schedule",
      cell: (a) => <span title={SCHEDULE_MODE[a.schedule.mode]}>{describeSchedule(a.schedule)}</span>,
    },
    {
      header: "Actions",
      className: "text-right",
      cell: (a) => (
        <div className="flex justify-end gap-2">
          {canSchedule && (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setEditing(a)}
              aria-label={`Change the schedule of ${a.target.name}`}
            >
              Schedule
            </Button>
          )}
          {canAssign && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setRemoving(a)}
              aria-label={`Remove the assignment of ${a.target.name}`}
            >
              Remove
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <Card
      title="Assignments"
      actions={
        canAssign && exam.status !== "ARCHIVED" ? <Button onClick={() => setAssigning(true)}>Assign</Button> : undefined
      }
    >
      {exam.status === "DRAFT" && (
        <p className="mb-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
          This exam is a draft: students don&apos;t see it, even when assigned, until it is published.
        </p>
      )}
      {exam.status === "ARCHIVED" && (
        <p className="mb-4 rounded-lg bg-slate-50 p-3 text-sm text-slate-600">Archived exams can&apos;t be assigned.</p>
      )}
      <Table
        caption="Assignments"
        columns={columns}
        rows={assignments.data}
        rowKey={(a) => a.id}
        loading={assignments.isPending}
        error={assignments.error}
        onRetry={() => void assignments.refetch()}
        empty={{
          title: "Not assigned to anyone",
          hint: "Students see an exam only when it is assigned to them or their group.",
        }}
      />

      <Dialog open={assigning} onOpenChange={setAssigning} title={`Assign “${exam.title}”`} wide>
        {assigning && (
          <AssignForm
            selection={{ examIds: [exam.id] }}
            onCancel={() => setAssigning(false)}
            onAssigned={(created) => {
              setAssigning(false);
              void refresh();
              toast(`${created} assignment${created === 1 ? "" : "s"} created`);
            }}
          />
        )}
      </Dialog>
      {editing && (
        <RescheduleDialog
          examId={exam.id}
          assignment={editing}
          canPreview={canAssign}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            await refresh();
            toast("Schedule changed");
          }}
        />
      )}
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(o) => !o && setRemoving(null)}
        title="Remove this assignment?"
        description={`“${exam.title}” is no longer assigned to ${removing?.target.name ?? ""}. Students keep their attempts and results.`}
        confirmLabel="Remove"
        danger
        onConfirm={async () => {
          if (!removing) return;
          await api.assignments.remove(removing.id);
          await refresh();
          toast("Assignment removed");
        }}
      />
    </Card>
  );
}

/** Change one assignment's schedule, previewing the new windows first. */
function RescheduleDialog({
  examId,
  assignment,
  canPreview,
  onClose,
  onSaved,
}: {
  examId: string;
  assignment: Assignment;
  /** The preview endpoint needs EXAM_ASSIGN; rescheduling alone needs only EXAM_SCHEDULE. */
  canPreview: boolean;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [draft, setDraft] = useState<ScheduleDraft>(() => draftFromSchedule(assignment.schedule));
  const [preview, setPreview] = useState<PreviewRow[] | null>(null);
  const parsed = toScheduleInput(draft);
  const schedule = "schedule" in parsed ? parsed.schedule : null;

  // The preview of a schedule change runs the same calculation for this one target.
  const previewMutation = useMutation({
    mutationFn: () =>
      schedule
        ? api.assignments.preview({ examIds: [examId], targets: [targetOf(assignment)], schedule })
        : Promise.resolve([]),
    onSuccess: setPreview,
  });
  const save = useMutation({
    mutationFn: () =>
      schedule ? api.assignments.reschedule(assignment.id, schedule) : Promise.reject(new Error("invalid")),
    onSuccess: async () => {
      await onSaved();
      onClose();
    },
  });

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={`Schedule for ${assignment.target.name}`}
      wide
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          {canPreview && (
            <Button
              variant="secondary"
              disabled={!schedule}
              busy={previewMutation.isPending}
              onClick={() => previewMutation.mutate()}
            >
              Preview
            </Button>
          )}
          <Button disabled={!schedule} busy={save.isPending} onClick={() => save.mutate()}>
            Save schedule
          </Button>
        </>
      }
    >
      <ScheduleFields
        draft={draft}
        onChange={(d) => {
          setDraft(d);
          setPreview(null);
        }}
      />
      {"problems" in parsed && (
        <ul className="list-disc pl-5 text-sm text-amber-800">
          {parsed.problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
      <FormError
        message={
          save.error ? errorMessage(save.error) : previewMutation.error ? errorMessage(previewMutation.error) : null
        }
      />
      {preview && <PreviewTable rows={preview} />}
    </Dialog>
  );
}
