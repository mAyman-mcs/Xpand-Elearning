import type { PersonRef, PreviewRow } from "@contracts";
import { Checkbox, TextInput } from "../../components/form";
import { PersonPicker } from "../../components/PersonPicker";
import { Table } from "../../components/Table";
import { Badge, cx } from "../../components/ui";
import type { TargetInput } from "../../lib/api";
import { SCHEDULE_MODE } from "../../lib/labels";
import type { ScheduleDraft } from "../../lib/schedule";
import { formatDate, formatInstant } from "../../lib/time";
import { useGroups } from "../users/queries";

// ─────────────────────────────── Schedule ───────────────────────────────

const MODE_HELP: Record<ScheduleDraft["mode"], string> = {
  FIXED: "The same dates for everyone.",
  RELATIVE: "Each student's own window, counted from their join date (or the group's intake date).",
  MANUAL: "Visible but closed; staff open it with “Open or close now”.",
};

/** The three schedule forms (FRONTEND_GUIDE §4.4). All times are Cairo time. */
export function ScheduleFields({ draft, onChange }: { draft: ScheduleDraft; onChange: (d: ScheduleDraft) => void }) {
  const set = (patch: Partial<ScheduleDraft>) => onChange({ ...draft, ...patch });
  return (
    <fieldset className="space-y-3">
      <legend className="text-sm font-bold text-slate-800">When it opens</legend>
      <div className="grid gap-2 sm:grid-cols-3">
        {(Object.keys(SCHEDULE_MODE) as ScheduleDraft["mode"][]).map((mode) => (
          <label
            key={mode}
            className={cx(
              "cursor-pointer rounded-lg border p-3 text-sm",
              draft.mode === mode ? "border-teal-500 bg-teal-50" : "border-slate-200",
            )}
          >
            <span className="flex items-center gap-2 font-semibold">
              <input
                type="radio"
                name="schedule-mode"
                checked={draft.mode === mode}
                onChange={() => set({ mode })}
                className="accent-teal-600"
              />
              {SCHEDULE_MODE[mode]}
            </span>
            <span className="mt-1 block text-xs text-slate-600">{MODE_HELP[mode]}</span>
          </label>
        ))}
      </div>

      {draft.mode === "FIXED" && (
        <div className="grid gap-3 sm:grid-cols-4">
          <TextInput
            label="Opens on (Cairo)"
            type="date"
            value={draft.opensDate}
            onChange={(e) => set({ opensDate: e.target.value })}
          />
          <TextInput
            label="Opening time"
            type="time"
            value={draft.opensTime}
            onChange={(e) => set({ opensTime: e.target.value })}
          />
          <TextInput
            label="Closes on (optional)"
            type="date"
            value={draft.closesDate}
            onChange={(e) => set({ closesDate: e.target.value })}
          />
          <TextInput
            label="Closing time"
            type="time"
            value={draft.closesTime}
            onChange={(e) => set({ closesTime: e.target.value })}
            disabled={!draft.closesDate}
          />
        </div>
      )}

      {draft.mode === "RELATIVE" && (
        <div className="grid gap-3 sm:grid-cols-4">
          <TextInput
            label="Days after joining"
            type="number"
            min={0}
            max={366}
            value={draft.offsetDays}
            onChange={(e) => set({ offsetDays: e.target.value })}
            hint="0 = the join day itself."
          />
          <TextInput
            label="At (Cairo time)"
            type="time"
            value={draft.openTime}
            onChange={(e) => set({ openTime: e.target.value })}
          />
          <TextInput
            label="Open for (hours)"
            type="number"
            min={0}
            value={draft.windowHours}
            onChange={(e) => set({ windowHours: e.target.value })}
          />
          <TextInput
            label="and minutes"
            type="number"
            min={0}
            max={59}
            value={draft.windowMins}
            onChange={(e) => set({ windowMins: e.target.value })}
          />
        </div>
      )}
    </fieldset>
  );
}

// ─────────────────────────────── Targets ───────────────────────────────

export interface Targets {
  groupIds: string[];
  people: PersonRef[];
}

export const toTargetInputs = (t: Targets): TargetInput[] => [
  ...t.groupIds.map((groupId) => ({ groupId })),
  ...t.people.map((p) => ({ userId: p.id })),
];

/** Groups and/or individual students. The lists are already limited to the caller's scope by the server. */
export function TargetPicker({ value, onChange }: { value: Targets; onChange: (t: Targets) => void }) {
  const groups = useGroups();
  return (
    <fieldset className="space-y-3">
      <legend className="text-sm font-bold text-slate-800">Who</legend>
      <div>
        <p className="mb-1 text-sm font-semibold text-slate-700">Groups</p>
        {groups.data?.length ? (
          <div className="grid max-h-40 gap-1 overflow-y-auto rounded-lg border border-slate-200 p-2 sm:grid-cols-2">
            {groups.data.map((g) => (
              <Checkbox
                key={g.id}
                label={`${g.name} (${g.memberCount}, intake ${formatDate(g.intakeStartDate)})`}
                checked={value.groupIds.includes(g.id)}
                onChange={() =>
                  onChange({
                    ...value,
                    groupIds: value.groupIds.includes(g.id)
                      ? value.groupIds.filter((x) => x !== g.id)
                      : [...value.groupIds, g.id],
                  })
                }
              />
            ))}
          </div>
        ) : (
          <p className="text-sm text-slate-600">No groups available.</p>
        )}
      </div>
      <PersonPicker
        label="Individual students"
        role="STUDENT"
        selected={value.people}
        onChange={(people) => onChange({ ...value, people })}
      />
      <p className="text-xs text-slate-600">
        A personal assignment replaces the student&apos;s group assignments for this exam (use it for a different date).
      </p>
    </fieldset>
  );
}

// ─────────────────────────────── Preview ───────────────────────────────

/** Each affected student's resolved window, computed by the server exactly as students will see it. */
export function PreviewTable({ rows, showExam }: { rows: PreviewRow[]; showExam?: boolean }) {
  return (
    <Table
      caption="Preview"
      rows={rows}
      rowKey={(r, i) => `${r.examId}-${r.student.id}-${i}`}
      empty={{ title: "Nobody is affected", hint: "The chosen groups have no members yet." }}
      columns={[
        ...(showExam ? [{ header: "Exam", cell: (r: PreviewRow) => r.examTitle }] : []),
        {
          header: "Student",
          cell: (r) => (
            <span>
              {r.student.fullName} <span className="font-mono text-xs text-slate-600">{r.student.username}</span>
            </span>
          ),
        },
        { header: "Counts from", cell: (r) => (r.anchorDate ? formatDate(r.anchorDate.slice(0, 10)) : "—") },
        {
          header: "Opens",
          cell: (r) =>
            r.opensAt ? (
              formatInstant(r.opensAt)
            ) : (
              <span className="text-amber-700">No window (manual, or no join date)</span>
            ),
        },
        { header: "Closes", cell: (r) => (r.opensAt ? (r.closesAt ? formatInstant(r.closesAt) : "No end") : "—") },
        {
          header: "Note",
          cell: (r) =>
            r.replacedByPersonalAssignment ? (
              <Badge tone="amber">Has a personal date: this won&apos;t apply</Badge>
            ) : null,
        },
      ]}
    />
  );
}
