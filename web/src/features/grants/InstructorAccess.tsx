import type { Grant, UserDetail } from "@contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { ConfirmDialog } from "../../components/Dialog";
import { useToast } from "../../components/Toast";
import { Badge, Button, Card, ErrorBanner, Loading } from "../../components/ui";
import { api } from "../../lib/api";
import { grantSentence, type ScopeNames } from "../../lib/grants";
import { qk } from "../../lib/query";
import { formatInstant } from "../../lib/time";
import { useAllExams, useCategories, useTags } from "../catalog/queries";
import { useGroups } from "../users/queries";
import { GrantEditor } from "./GrantEditor";

// An instructor's access ("grants") is managed on their user page, next to their account.

export function useGrants(userId?: string) {
  return useQuery({ queryKey: [...qk.grants, userId ?? "all"], queryFn: () => api.grants.list(userId) });
}

/** Names for grant sentences. Archived categories are included: old grants may still list them. */
function useScopeNames(): ScopeNames {
  const exams = useAllExams();
  const categories = useCategories(true);
  const tags = useTags();
  const groups = useGroups();
  return useMemo(
    () => ({
      exams: new Map((exams.data ?? []).map((e) => [e.id, e.title])),
      categories: new Map((categories.data ?? []).map((c) => [c.id, c.name])),
      tags: new Map((tags.data ?? []).map((t) => [t.id, t.name])),
      groups: new Map((groups.data ?? []).map((g) => [g.id, g.name])),
    }),
    [exams.data, categories.data, tags.data, groups.data],
  );
}

/** "3 active" / "No access" for the users list; one request for every instructor. */
export function useAccessSummary(enabled: boolean) {
  const grants = useQuery({ queryKey: [...qk.grants, "all"], queryFn: () => api.grants.list(), enabled });
  return useMemo(() => {
    const active = new Map<string, number>();
    for (const g of grants.data ?? []) if (g.active) active.set(g.userId, (active.get(g.userId) ?? 0) + 1);
    return { loaded: !!grants.data, active: (userId: string) => active.get(userId) ?? 0 };
  }, [grants.data]);
}

/** The "Access" card of an instructor's user page: what they may do, on which exams and students. */
export function InstructorAccess({ user: u }: { user: UserDetail }) {
  const grants = useGrants(u.id);
  const names = useScopeNames();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [editing, setEditing] = useState<Grant | "new" | null>(null);
  const [deleting, setDeleting] = useState<Grant | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: qk.grants });

  return (
    <Card title="Access" actions={<Button onClick={() => setEditing("new")}>Grant access</Button>}>
      <p className="mb-3 text-sm text-slate-600">
        Instructors see and do only what these grants allow. Changes apply from their next click.
      </p>
      {grants.isPending && <Loading />}
      <ErrorBanner error={grants.error} onRetry={() => void grants.refetch()} />
      {grants.data && !grants.data.length && (
        <p className="rounded-lg bg-warning-50 p-3 text-sm text-warning-800">
          No access yet: {u.fullName} sees nothing until you grant access.
        </p>
      )}
      <ul className="divide-y divide-slate-100" aria-label="Grants">
        {grants.data?.map((g) => (
          <li key={g.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
            <div className="min-w-0 flex-1">
              <div className="mb-1">{g.active ? <Badge tone="green">Active</Badge> : <Badge>Expired</Badge>}</div>
              <p className="text-sm text-slate-800">{grantSentence(g, names)}</p>
              <p className="mt-1 text-xs text-slate-600">Granted {formatInstant(g.createdAt)}</p>
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" onClick={() => setEditing(g)}>
                Edit
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setDeleting(g)}>
                Remove
              </Button>
            </div>
          </li>
        ))}
      </ul>

      {editing && (
        <GrantEditor
          open
          key={editing === "new" ? "new" : editing.id}
          onClose={() => setEditing(null)}
          instructor={u}
          grant={editing === "new" ? undefined : editing}
          names={names}
          onSaved={async () => {
            await refresh();
            toast(editing === "new" ? "Access granted" : "Access updated");
          }}
        />
      )}
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Remove this access?"
        description={
          deleting ? `${u.fullName} loses: ${grantSentence(deleting, names)} This applies from their next click.` : ""
        }
        confirmLabel="Remove access"
        danger
        onConfirm={async () => {
          if (!deleting) return;
          await api.grants.remove(deleting.id);
          await refresh();
          toast("Access removed");
        }}
      />
    </Card>
  );
}
