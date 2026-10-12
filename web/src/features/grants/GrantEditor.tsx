import type { Grant, GrantScopeFields, Permission } from "@contracts";
import { useMutation } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Dialog } from "../../components/Dialog";
import { Checkbox, FormError, TextInput } from "../../components/form";
import { Button, cx } from "../../components/ui";
import { api, errorMessage } from "../../lib/api";
import { grantSentence, type ScopeNames } from "../../lib/grants";
import { ALL_PERMISSIONS, PERMISSION_LABELS } from "../../lib/permissions";
import { cairoToIso, isoToCairo, todayInCairo } from "../../lib/time";
import { useCategories, useAllExams } from "../catalog/queries";
import { useGroups } from "../users/queries";

// Permissions whose features exist today; the rest are granted ahead of their phase (NEXT_PLAN).
const LATER: Permission[] = ["RESULTS_RELEASE", "PROCTOR", "ATTEMPT_VOID", "ATTEMPT_REVIEW", "AUDIT_VIEW"];

interface Draft {
  permissions: Permission[];
  examMode: "all" | "some";
  examIds: string[];
  categoryIds: string[];
  groupMode: "all" | "some";
  groupIds: string[];
  /** Cairo date; the grant ends at 23:59 that day. Empty = no expiry. */
  expires: string;
}

function draftOf(g?: Grant): Draft {
  return {
    permissions: g?.permissions ?? [],
    examMode: g?.allExams ? "all" : "some",
    examIds: g?.examIds ?? [],
    categoryIds: g?.categoryIds ?? [],
    groupMode: g?.allGroups ? "all" : "some",
    groupIds: g?.groupIds ?? [],
    expires: g?.expiresAt ? isoToCairo(g.expiresAt).date : "",
  };
}

export function toScope(d: Draft): GrantScopeFields {
  return {
    permissions: d.permissions,
    allExams: d.examMode === "all",
    examIds: d.examMode === "all" ? [] : d.examIds,
    categoryIds: d.examMode === "all" ? [] : d.categoryIds,
    allGroups: d.groupMode === "all",
    groupIds: d.groupMode === "all" ? [] : d.groupIds,
    expiresAt: d.expires ? new Date(new Date(cairoToIso(d.expires, "23:59")).getTime() + 59_999).toISOString() : null,
  };
}

/** Problems the server would refuse anyway, shown before sending. */
export function draftProblems(d: Draft, today: string): string[] {
  const problems: string[] = [];
  if (!d.permissions.length) problems.push("Choose at least one permission.");
  if (d.examMode === "some" && !d.examIds.length && !d.categoryIds.length)
    problems.push("Choose the exams: all exams, or at least one category or exam.");
  if (d.groupMode === "some" && !d.groupIds.length)
    problems.push("Choose the students: every group, or at least one group.");
  if (d.expires && d.expires < today) problems.push("The expiry date is in the past.");
  return problems;
}

const toggle = <T,>(list: T[], item: T) => (list.includes(item) ? list.filter((x) => x !== item) : [...list, item]);

interface Props {
  open: boolean;
  onClose: () => void;
  instructor: { id: string; fullName: string };
  /** Editing an existing grant; creating when absent. */
  grant?: Grant;
  names: ScopeNames;
  onSaved: () => Promise<void>;
}

/** Create or edit one grant: permissions × exams × groups × expiry (FRONTEND_GUIDE §4.4). */
export function GrantEditor({ open, onClose, instructor, grant, names, onSaved }: Props) {
  const [draft, setDraft] = useState<Draft>(() => draftOf(grant));
  const [examSearch, setExamSearch] = useState("");
  const exams = useAllExams();
  const categories = useCategories();
  const groups = useGroups();
  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));

  const problems = draftProblems(draft, todayInCairo());
  const scope = toScope(draft);
  const save = useMutation({
    mutationFn: () =>
      grant ? api.grants.update(grant.id, scope) : api.grants.create({ ...scope, userId: instructor.id }),
    onSuccess: async () => {
      await onSaved();
      onClose();
    },
  });

  const visibleExams = useMemo(() => {
    const q = examSearch.trim().toLowerCase();
    return (exams.data ?? []).filter(
      (e) =>
        !q || e.title.toLowerCase().includes(q) || e.code.toLowerCase().includes(q) || draft.examIds.includes(e.id),
    );
  }, [exams.data, examSearch, draft.examIds]);

  const radio = (name: string, value: string, checked: boolean, label: string, onPick: () => void) => (
    <label
      className={cx(
        "flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm",
        checked ? "border-teal-500 bg-teal-50" : "border-slate-200",
      )}
    >
      <input type="radio" name={name} value={value} checked={checked} onChange={onPick} className="accent-teal-600" />
      {label}
    </label>
  );

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={grant ? `Edit access of ${instructor.fullName}` : `New access for ${instructor.fullName}`}
      description="One grant must cover both the exam and the student: separate grants are never combined."
      wide
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button busy={save.isPending} disabled={problems.length > 0} onClick={() => save.mutate()}>
            {grant ? "Save access" : "Grant access"}
          </Button>
        </>
      }
    >
      <fieldset>
        <legend className="mb-2 text-sm font-bold text-slate-800">What they can do</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {ALL_PERMISSIONS.map((p) => (
            <Checkbox
              key={p}
              label={PERMISSION_LABELS[p]}
              hint={LATER.includes(p) ? "Takes effect when this feature ships." : undefined}
              checked={draft.permissions.includes(p)}
              onChange={() => set({ permissions: toggle(draft.permissions, p) })}
            />
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend className="mb-2 text-sm font-bold text-slate-800">On which exams</legend>
        <div className="mb-3 grid gap-2 sm:grid-cols-2">
          {radio("examMode", "all", draft.examMode === "all", "All exams (including future ones)", () =>
            set({ examMode: "all" }),
          )}
          {radio("examMode", "some", draft.examMode === "some", "Chosen categories or exams", () =>
            set({ examMode: "some" }),
          )}
        </div>
        {draft.examMode === "some" && (
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <p className="mb-1 text-sm font-semibold text-slate-700">Categories (include future exams)</p>
              <div className="max-h-48 space-y-1 overflow-y-auto rounded-lg border border-slate-200 p-2">
                {categories.data?.length ? (
                  categories.data.map((c) => (
                    <Checkbox
                      key={c.id}
                      label={c.name}
                      checked={draft.categoryIds.includes(c.id)}
                      onChange={() => set({ categoryIds: toggle(draft.categoryIds, c.id) })}
                    />
                  ))
                ) : (
                  <p className="text-sm text-slate-500">No categories yet.</p>
                )}
              </div>
            </div>
            <div>
              <TextInput
                label="Single exams"
                type="search"
                placeholder="Search exams"
                value={examSearch}
                onChange={(e) => setExamSearch(e.target.value)}
              />
              <div className="mt-1 max-h-40 space-y-1 overflow-y-auto rounded-lg border border-slate-200 p-2">
                {visibleExams.length ? (
                  visibleExams.map((e) => (
                    <Checkbox
                      key={e.id}
                      label={`${e.title} (${e.code})`}
                      checked={draft.examIds.includes(e.id)}
                      onChange={() => set({ examIds: toggle(draft.examIds, e.id) })}
                    />
                  ))
                ) : (
                  <p className="text-sm text-slate-500">No exams match.</p>
                )}
              </div>
            </div>
          </div>
        )}
      </fieldset>

      <fieldset>
        <legend className="mb-2 text-sm font-bold text-slate-800">For which students</legend>
        <div className="mb-3 grid gap-2 sm:grid-cols-2">
          {radio("groupMode", "all", draft.groupMode === "all", "Every group (all students)", () =>
            set({ groupMode: "all" }),
          )}
          {radio("groupMode", "some", draft.groupMode === "some", "Students in chosen groups", () =>
            set({ groupMode: "some" }),
          )}
        </div>
        {draft.groupMode === "some" && (
          <div className="grid max-h-40 gap-1 overflow-y-auto rounded-lg border border-slate-200 p-2 sm:grid-cols-2">
            {groups.data?.map((g) => (
              <Checkbox
                key={g.id}
                label={g.name}
                checked={draft.groupIds.includes(g.id)}
                onChange={() => set({ groupIds: toggle(draft.groupIds, g.id) })}
              />
            ))}
          </div>
        )}
      </fieldset>

      <TextInput
        label="Expires after (Cairo date, optional)"
        type="date"
        value={draft.expires}
        onChange={(e) => set({ expires: e.target.value })}
        hint="The access ends at 23:59 Cairo time that day. Leave empty for no expiry."
      />

      <div className="rounded-lg bg-slate-50 p-3 text-sm" aria-live="polite">
        <p className="text-xs font-semibold text-slate-500 uppercase">This grant means</p>
        {problems.length ? (
          <ul className="mt-1 list-disc pl-5 text-amber-800">
            {problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-slate-800" data-testid="grant-preview">
            {grantSentence(scope, names)}
          </p>
        )}
      </div>
      <FormError message={save.error ? errorMessage(save.error) : null} />
    </Dialog>
  );
}
