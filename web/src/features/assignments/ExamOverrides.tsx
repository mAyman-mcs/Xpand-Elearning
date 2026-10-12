import type { Override, OverrideAction, PersonRef } from "@contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ConfirmDialog, Dialog } from "../../components/Dialog";
import { Checkbox, FormError, SelectInput, TextArea, TextInput } from "../../components/form";
import { PersonPicker } from "../../components/PersonPicker";
import { Table, type Column } from "../../components/Table";
import { useToast } from "../../components/Toast";
import { Badge, Button, Card, cx } from "../../components/ui";
import { api, errorMessage, type TargetInput } from "../../lib/api";
import { qk } from "../../lib/query";
import { cairoToIso, formatInstant } from "../../lib/time";
import { useExam } from "../exams/ExamLayout";
import { useGroups } from "../users/queries";

/** /exams/:id/overrides: open or close the exam now, on top of its schedule. */
export function ExamOverrides() {
  const { exam, allowed } = useExam();
  const canSchedule = allowed("EXAM_SCHEDULE");
  const [includeEnded, setIncludeEnded] = useState(false);
  const overrides = useQuery({
    queryKey: [...qk.overrides(exam.id), includeEnded],
    queryFn: () => api.overrides.list(exam.id, includeEnded),
  });
  const queryClient = useQueryClient();
  const toast = useToast();
  const [creating, setCreating] = useState(false);
  const [ending, setEnding] = useState<Override | null>(null);

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: qk.overrides(exam.id) });
    await queryClient.invalidateQueries({ queryKey: qk.availability(exam.id) });
    await queryClient.invalidateQueries({ queryKey: qk.stats });
  };

  const columns: Column<Override>[] = [
    {
      header: "Action",
      cell: (o) => (
        <Badge tone={o.action === "OPEN" ? "green" : "red"}>{o.action === "OPEN" ? "Opened" : "Closed"}</Badge>
      ),
    },
    {
      header: "For",
      cell: (o) => (
        <span>
          <span className="text-xs text-slate-600">{o.target.type === "group" ? "Group " : "Student "}</span>
          <span className="font-semibold">{o.target.name}</span>
        </span>
      ),
    },
    {
      header: "From – until",
      cell: (o) => (
        <span className="text-sm">
          {formatInstant(o.validFrom)} – {o.validUntil ? formatInstant(o.validUntil) : "until ended"}
        </span>
      ),
    },
    { header: "Reason", cell: (o) => o.reason ?? "—" },
    {
      header: "",
      className: "text-right",
      cell: (o) =>
        o.active ? (
          canSchedule && (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setEnding(o)}
              aria-label={`End the override for ${o.target.name}`}
            >
              End now
            </Button>
          )
        ) : (
          <Badge>Ended</Badge>
        ),
    },
  ];

  return (
    <div className="space-y-6">
      <Card
        title="Open or close now"
        actions={canSchedule ? <Button onClick={() => setCreating(true)}>Open or close now</Button> : undefined}
      >
        <div className="mb-4 rounded-lg bg-sky-50 p-3 text-sm text-sky-900">
          <p className="font-semibold">Which rule wins</p>
          <ol className="mt-1 list-decimal pl-5">
            <li>The student&apos;s own newest override.</li>
            <li>Otherwise group overrides; a group close beats a group open.</li>
            <li>Otherwise the schedule.</li>
          </ol>
          <p className="mt-1">
            An override never reopens an exam whose attempts are used up, and doesn&apos;t make an unassigned exam
            visible.
          </p>
        </div>
        <Checkbox
          className="mb-3"
          label="Show ended overrides"
          checked={includeEnded}
          onChange={(e) => setIncludeEnded(e.target.checked)}
        />
        <Table
          caption="Overrides"
          columns={columns}
          rows={overrides.data}
          rowKey={(o) => o.id}
          loading={overrides.isPending}
          error={overrides.error}
          onRetry={() => void overrides.refetch()}
          empty={{ title: includeEnded ? "No overrides yet" : "No active overrides", hint: "The schedule decides." }}
        />
      </Card>

      {creating && (
        <NewOverrideDialog
          examId={exam.id}
          onClose={() => setCreating(false)}
          onSaved={async (action) => {
            await refresh();
            toast(action === "OPEN" ? "Exam opened" : "Exam closed");
          }}
        />
      )}
      <ConfirmDialog
        open={ending !== null}
        onOpenChange={(o) => !o && setEnding(null)}
        title="End this override now?"
        description="The schedule (or other overrides) decides again from now on. The override stays in the history."
        confirmLabel="End now"
        onConfirm={async () => {
          if (!ending) return;
          await api.overrides.end(ending.id);
          await refresh();
          toast("Override ended");
        }}
      />
    </div>
  );
}

function NewOverrideDialog({
  examId,
  onClose,
  onSaved,
}: {
  examId: string;
  onClose: () => void;
  onSaved: (action: OverrideAction) => Promise<void>;
}) {
  const groups = useGroups();
  const [action, setAction] = useState<OverrideAction>("OPEN");
  const [kind, setKind] = useState<"group" | "user">("group");
  const [groupId, setGroupId] = useState("");
  const [person, setPerson] = useState<PersonRef[]>([]);
  const [untilDate, setUntilDate] = useState("");
  const [untilTime, setUntilTime] = useState("");
  const [reason, setReason] = useState("");

  const target: TargetInput | null =
    kind === "group" ? (groupId ? { groupId } : null) : person[0] ? { userId: person[0].id } : null;
  const validUntil = untilDate && untilTime ? cairoToIso(untilDate, untilTime) : null;
  const problems = [
    ...(target ? [] : [kind === "group" ? "Choose a group." : "Choose a student."]),
    ...(reason.trim() ? [] : ["Give a reason (it goes into the audit log)."]),
    ...(untilDate && !untilTime ? ["Choose the end time, or clear the end date."] : []),
    ...(validUntil && validUntil <= new Date().toISOString() ? ["The end must be in the future."] : []),
  ];

  const save = useMutation({
    mutationFn: () =>
      api.overrides.create({ examId, target: target ?? { groupId: "" }, action, validUntil, reason: reason.trim() }),
    onSuccess: async () => {
      await onSaved(action);
      onClose();
    },
  });

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Open or close now"
      description="Starts immediately and lasts until the end time, or until someone ends it."
      wide
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant={action === "CLOSE" ? "danger" : "primary"}
            disabled={problems.length > 0}
            busy={save.isPending}
            onClick={() => save.mutate()}
          >
            {action === "OPEN" ? "Open now" : "Close now"}
          </Button>
        </>
      }
    >
      <fieldset>
        <legend className="mb-2 text-sm font-bold text-slate-800">Action</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {(["OPEN", "CLOSE"] as const).map((a) => (
            <label
              key={a}
              className={cx(
                "flex cursor-pointer items-center gap-2 rounded-lg border p-3 text-sm",
                action === a ? "border-teal-500 bg-teal-50" : "border-slate-200",
              )}
            >
              <input
                type="radio"
                name="override-action"
                checked={action === a}
                onChange={() => setAction(a)}
                className="accent-teal-600"
              />
              {a === "OPEN" ? "Open the exam" : "Close the exam"}
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend className="mb-2 text-sm font-bold text-slate-800">For</legend>
        <div className="mb-3 grid gap-2 sm:grid-cols-2">
          {(["group", "user"] as const).map((k) => (
            <label
              key={k}
              className={cx(
                "flex cursor-pointer items-center gap-2 rounded-lg border p-3 text-sm",
                kind === k ? "border-teal-500 bg-teal-50" : "border-slate-200",
              )}
            >
              <input
                type="radio"
                name="override-kind"
                checked={kind === k}
                onChange={() => setKind(k)}
                className="accent-teal-600"
              />
              {k === "group" ? "A whole group" : "One student"}
            </label>
          ))}
        </div>
        {kind === "group" ? (
          <SelectInput label="Group" value={groupId} onChange={(e) => setGroupId(e.target.value)}>
            <option value="">Choose…</option>
            {groups.data?.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </SelectInput>
        ) : (
          <PersonPicker label="Student" role="STUDENT" selected={person} onChange={setPerson} max={1} />
        )}
      </fieldset>
      <div className="grid gap-3 sm:grid-cols-2">
        <TextInput
          label="Ends on (Cairo, optional)"
          type="date"
          value={untilDate}
          onChange={(e) => setUntilDate(e.target.value)}
        />
        <TextInput
          label="End time"
          type="time"
          value={untilTime}
          onChange={(e) => setUntilTime(e.target.value)}
          disabled={!untilDate}
        />
      </div>
      <TextArea
        label="Reason"
        required
        rows={2}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        hint="E.g. “Approved make-up assessment”."
      />
      {problems.length > 0 && (
        <ul className="list-disc pl-5 text-sm text-slate-600">
          {problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
      <FormError message={save.error ? errorMessage(save.error) : null} />
    </Dialog>
  );
}
