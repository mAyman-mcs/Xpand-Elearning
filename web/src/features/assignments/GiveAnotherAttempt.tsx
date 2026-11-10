import type { PersonRef } from "@contracts";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { usePermissions } from "../../app/auth";
import { Dialog } from "../../components/Dialog";
import { Checkbox, FormError, TextArea, TextInput } from "../../components/form";
import { useToast } from "../../components/Toast";
import { Button } from "../../components/ui";
import { api, errorMessage } from "../../lib/api";
import { can, type ExamRef } from "../../lib/permissions";
import { qk } from "../../lib/query";
import { cairoToIso, isoToCairo, ZONE_LABEL } from "../../lib/time";

export interface AnotherAttemptTarget {
  exam: { id: string; title: string } & Partial<Pick<ExamRef, "categoryId" | "tagIds">>;
  student: PersonRef;
}

/**
 * "Give another attempt": the student keeps their old attempt (answers and grade) and may take the
 * exam once more. Optionally opens it for them right away, until a chosen time.
 */
export function GiveAnotherAttempt({ target, onClose }: { target: AnotherAttemptTarget; onClose: () => void }) {
  const client = useQueryClient();
  const toast = useToast();
  const { data: perms } = usePermissions();
  const { exam, student } = target;
  const ref = exam.categoryId ? { id: exam.id, categoryId: exam.categoryId, tagIds: exam.tagIds ?? [] } : undefined;
  // Opening needs schedule access; without it, the attempt is still given (staff open it later).
  const mayOpen = can(perms, "EXAM_SCHEDULE", ref);
  const tomorrow = isoToCairo(new Date(Date.now() + 24 * 3_600_000).toISOString());

  const [reason, setReason] = useState("");
  const [openNow, setOpenNow] = useState(mayOpen);
  const [untilDate, setUntilDate] = useState(tomorrow.date);
  const [untilTime, setUntilTime] = useState(tomorrow.time);

  const openUntil = openNow && untilDate && untilTime ? cairoToIso(untilDate, untilTime) : null;
  const problems = [
    ...(reason.trim() ? [] : ["Give a reason (it goes into the audit log)."]),
    ...(openNow && !openUntil ? ["Choose until when the exam stays open."] : []),
    ...(openUntil && openUntil <= new Date().toISOString() ? ["The end must be in the future."] : []),
  ];

  const give = useMutation({
    mutationFn: () =>
      api.assignments.giveAnotherAttempt({ examId: exam.id, userId: student.id, reason: reason.trim(), openUntil }),
    onSuccess: async (row) => {
      await Promise.all([
        client.invalidateQueries({ queryKey: qk.submissions }),
        client.invalidateQueries({ queryKey: qk.dashboard }),
        client.invalidateQueries({ queryKey: qk.availability(exam.id) }),
        client.invalidateQueries({ queryKey: qk.overrides(exam.id) }),
      ]);
      toast(
        row.status === "OPEN"
          ? `${student.fullName} can take ${exam.title} again now.`
          : `${student.fullName} has another attempt. The exam isn't open for them yet: ${row.reason}`,
      );
      onClose();
    },
  });

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && !give.isPending && onClose()}
      title={`Give ${student.fullName} another attempt?`}
      description={
        <>
          At <strong>{exam.title}</strong>. Their submitted attempt stays as it is (answers and grade); they get one
          more.
        </>
      }
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={give.isPending}>
            Cancel
          </Button>
          <Button disabled={problems.length > 0} busy={give.isPending} onClick={() => give.mutate()}>
            Give another attempt
          </Button>
        </>
      }
    >
      <TextArea
        label="Reason (kept in the audit log)"
        required
        rows={2}
        maxLength={500}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
      />
      {mayOpen ? (
        <Checkbox
          label="Open the exam for them now"
          hint="Without this, they can take it only when their schedule opens it, or when staff open it."
          checked={openNow}
          onChange={(e) => setOpenNow(e.target.checked)}
        />
      ) : (
        <p className="text-sm text-slate-600">
          They can take it when their schedule opens it. To open it now, ask someone who can schedule this exam.
        </p>
      )}
      {openNow && (
        <div className="grid gap-3 sm:grid-cols-2">
          <TextInput
            label={`Open until (date, ${ZONE_LABEL})`}
            type="date"
            value={untilDate}
            onChange={(e) => setUntilDate(e.target.value)}
          />
          <TextInput
            label={`Time (${ZONE_LABEL})`}
            type="time"
            value={untilTime}
            onChange={(e) => setUntilTime(e.target.value)}
          />
        </div>
      )}
      {reason.trim() && problems.length > 0 && <p className="text-sm text-amber-800">{problems[0]}</p>}
      <FormError message={give.error ? errorMessage(give.error) : null} />
    </Dialog>
  );
}
