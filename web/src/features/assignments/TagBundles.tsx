import type { TagBundle } from "@contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router";
import { ConfirmDialog } from "../../components/Dialog";
import { Checkbox, FormError, SelectInput } from "../../components/form";
import { Table, type Column } from "../../components/Table";
import { useToast } from "../../components/Toast";
import { Badge, Button } from "../../components/ui";
import { api, ApiError, errorMessage } from "../../lib/api";
import { SCHEDULE_MODE } from "../../lib/labels";
import { qk } from "../../lib/query";
import { describeSchedule, EMPTY_SCHEDULE, toScheduleInput, type ScheduleDraft } from "../../lib/schedule";
import { useTags } from "../catalog/queries";
import { useGroups } from "../users/queries";
import { ScheduleFields } from "./components";

// A tag given to a group is a live bundle: the group gets every exam carrying the tag, including
// exams tagged later. Taking the tag off an exam takes the exam away from the group again.

export function useTagBundles(filter: { groupId?: string } = {}) {
  return useQuery({
    queryKey: [...qk.tagBundles, filter.groupId ?? "all"],
    queryFn: () => api.tagBundles.list(filter),
  });
}

/** The server's refusals, in words. */
function giveError(e: unknown): string {
  if (e instanceof ApiError && e.code === "CONFLICT") return "This tag is already given to that group.";
  if (e instanceof ApiError && (e.code === "FORBIDDEN" || e.code === "NOT_FOUND"))
    return "You may not give this tag to that group: your access must cover every exam with the tag, and the group.";
  return errorMessage(e);
}

/**
 * Tag + groups + schedule → one bundle per group. `groupId` fixes the group (the group's page).
 * Groups that already have the tag are skipped, so a partly done request can be sent again.
 */
export function GiveTagForm({
  groupId,
  onGiven,
  onCancel,
}: {
  groupId?: string;
  onGiven: (count: number) => void;
  onCancel?: () => void;
}) {
  const tags = useTags();
  const groups = useGroups();
  const bundles = useTagBundles();
  const queryClient = useQueryClient();
  const [tagId, setTagId] = useState("");
  const [groupIds, setGroupIds] = useState<string[]>(groupId ? [groupId] : []);
  const [draft, setDraft] = useState<ScheduleDraft>(EMPTY_SCHEDULE);

  const tag = tags.data?.find((t) => t.id === tagId);
  const has = (gid: string) => !!bundles.data?.some((b) => b.tag.id === tagId && b.group.id === gid);
  const todo = groupIds.filter((gid) => !has(gid));
  const parsed = toScheduleInput(draft);
  const problems = [
    ...(tagId ? [] : ["Choose a tag."]),
    ...(groupIds.length ? [] : ["Choose at least one group."]),
    ...(tagId && groupIds.length && !todo.length ? ["The chosen groups already have this tag."] : []),
    ...("problems" in parsed ? parsed.problems : []),
  ];

  const give = useMutation({
    mutationFn: async () => {
      if (!("schedule" in parsed)) return 0;
      for (const gid of todo) await api.tagBundles.create({ tagId, groupId: gid, schedule: parsed.schedule });
      return todo.length;
    },
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: ["assignments"] });
      await queryClient.invalidateQueries({ queryKey: ["availability"] });
      await queryClient.invalidateQueries({ queryKey: qk.stats });
    },
    onSuccess: onGiven,
  });

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <SelectInput label="Tag" value={tagId} onChange={(e) => setTagId(e.target.value)}>
          <option value="">Choose…</option>
          {tags.data?.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name} ({t.examCount ?? 0} exam{t.examCount === 1 ? "" : "s"})
            </option>
          ))}
        </SelectInput>
        {tag && (
          <p className="text-sm text-slate-600">
            {tag.examCount ?? 0} exam{tag.examCount === 1 ? " has" : "s have"} this tag now. Exams tagged later are
            added on their own, and an exam whose tag is taken off is removed.
          </p>
        )}
        {!tags.isPending && !tags.data?.length && <p className="text-sm text-slate-600">No tags yet.</p>}
      </div>

      {!groupId && (
        <fieldset className="space-y-2">
          <legend className="text-sm font-bold text-slate-800">Groups</legend>
          <div className="grid max-h-48 gap-1 overflow-y-auto rounded-lg border border-slate-200 p-2 sm:grid-cols-2">
            {groups.data?.map((g) => (
              <Checkbox
                key={g.id}
                label={has(g.id) ? `${g.name} (has it)` : g.name}
                checked={groupIds.includes(g.id)}
                disabled={has(g.id)}
                onChange={() =>
                  setGroupIds(groupIds.includes(g.id) ? groupIds.filter((x) => x !== g.id) : [...groupIds, g.id])
                }
              />
            ))}
            {!groups.isPending && !groups.data?.length && <p className="text-sm text-slate-600">No groups.</p>}
          </div>
        </fieldset>
      )}

      <ScheduleFields draft={draft} onChange={setDraft} />
      <p className="text-xs text-slate-600">
        Every exam with the tag gets this schedule. To give one exam other dates, change its schedule on the exam’s “Who
        and when” tab (it then leaves the tag).
      </p>

      {problems.length > 0 && (
        <ul className="list-disc rounded-lg bg-slate-50 p-3 pl-8 text-sm text-slate-600" aria-live="polite">
          {problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
      <FormError message={give.error ? giveError(give.error) : null} />

      <div className="flex flex-wrap justify-end gap-2">
        {onCancel && (
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
        )}
        <Button busy={give.isPending} disabled={problems.length > 0} onClick={() => give.mutate()}>
          Give the tag
        </Button>
      </div>
    </div>
  );
}

/** Tags given to groups, with Remove. `groupId` limits it to one group (and hides that column). */
export function TagBundleTable({ groupId }: { groupId?: string }) {
  const bundles = useTagBundles({ groupId });
  const queryClient = useQueryClient();
  const toast = useToast();
  const [removing, setRemoving] = useState<TagBundle | null>(null);

  const columns: Column<TagBundle>[] = [
    { header: "Tag", cell: (b) => <Badge tone="outline">{b.tag.name}</Badge> },
    ...(groupId
      ? []
      : [
          {
            header: "Group",
            cell: (b: TagBundle) => <span className="font-semibold">{b.group.name}</span>,
          },
        ]),
    {
      header: "Exams",
      cell: (b) => (
        <Link to={`/exams?tags=${b.tag.id}`} className="text-brand-700 hover:underline">
          {b.examCount} exam{b.examCount === 1 ? "" : "s"}
        </Link>
      ),
    },
    {
      header: "Schedule",
      cell: (b) => <span title={SCHEDULE_MODE[b.schedule.mode]}>{describeSchedule(b.schedule)}</span>,
    },
    {
      header: "Actions",
      className: "text-right",
      cell: (b) => (
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setRemoving(b)}
          aria-label={`Take “${b.tag.name}” away from ${b.group.name}`}
        >
          Remove
        </Button>
      ),
    },
  ];

  return (
    <>
      <Table
        caption="Tags given to groups"
        columns={columns}
        rows={bundles.data}
        rowKey={(b) => b.id}
        loading={bundles.isPending}
        error={bundles.error}
        onRetry={() => void bundles.refetch()}
        empty={{
          title: "No tags given yet",
          hint: "Give a tag to a group to assign it every exam with that tag, now and later.",
        }}
      />
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(o) => !o && setRemoving(null)}
        title="Take the tag away?"
        description={`${removing?.group.name ?? ""} loses the exams it has through “${removing?.tag.name ?? ""}” (exams also assigned to it another way stay). Students keep their attempts and results.`}
        confirmLabel="Take it away"
        danger
        onConfirm={async () => {
          if (!removing) return;
          await api.tagBundles.remove(removing.id);
          await queryClient.invalidateQueries({ queryKey: ["assignments"] });
          await queryClient.invalidateQueries({ queryKey: ["availability"] });
          toast(`“${removing.tag.name}” taken away from ${removing.group.name}`);
        }}
      />
    </>
  );
}
