import type { Grant, UserDetail } from "@contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Link, useParams } from "react-router";
import { QueryErrorPage, usePageTitle } from "../../app/pages";
import { ConfirmDialog } from "../../components/Dialog";
import { Table, type Column } from "../../components/Table";
import { useToast } from "../../components/Toast";
import { Badge, Button, ButtonLink, Card, EmptyState, ErrorBanner, Loading, PageHeader } from "../../components/ui";
import { api } from "../../lib/api";
import { grantSentence, type ScopeNames } from "../../lib/grants";
import { accountState } from "../../lib/labels";
import { qk } from "../../lib/query";
import { formatInstant } from "../../lib/time";
import { useAllExams, useCategories } from "../catalog/queries";
import { useGroups, useUser, useUsers } from "../users/queries";
import { GrantEditor } from "./GrantEditor";

function useGrants(userId?: string) {
  return useQuery({ queryKey: [...qk.grants, userId ?? "all"], queryFn: () => api.grants.list(userId) });
}

/** Names for grant sentences. Archived categories are included: old grants may still list them. */
function useScopeNames(): ScopeNames {
  const exams = useAllExams();
  const categories = useCategories(true);
  const groups = useGroups();
  return useMemo(
    () => ({
      exams: new Map((exams.data ?? []).map((e) => [e.id, e.title])),
      categories: new Map((categories.data ?? []).map((c) => [c.id, c.name])),
      groups: new Map((groups.data ?? []).map((g) => [g.id, g.name])),
    }),
    [exams.data, categories.data, groups.data],
  );
}

export function InstructorsList() {
  usePageTitle("Instructors");
  const instructors = useUsers({ role: "INSTRUCTOR", includeInactive: true });
  const grants = useGrants();
  const byUser = useMemo(() => {
    const map = new Map<string, Grant[]>();
    for (const g of grants.data ?? []) map.set(g.userId, [...(map.get(g.userId) ?? []), g]);
    return map;
  }, [grants.data]);

  const columns: Column<UserDetail>[] = [
    {
      header: "Instructor",
      cell: (u) => (
        <Link to={`/admin/instructors/${u.id}`} className="font-semibold text-teal-700 hover:underline">
          {u.fullName}
          <span className="block font-mono text-xs font-normal text-slate-600">{u.username}</span>
        </Link>
      ),
    },
    {
      header: "Active grants",
      cell: (u) => {
        const active = (byUser.get(u.id) ?? []).filter((g) => g.active).length;
        return active ? active : <Badge tone="amber">No access</Badge>;
      },
    },
    {
      header: "Next expiry",
      cell: (u) => {
        const next = (byUser.get(u.id) ?? [])
          .filter((g) => g.active && g.expiresAt)
          .map((g) => g.expiresAt ?? "")
          .sort()[0];
        return next ? formatInstant(next) : "—";
      },
    },
    {
      header: "Account",
      cell: (u) => {
        const s = accountState(u);
        return <Badge tone={s.tone}>{s.label}</Badge>;
      },
    },
  ];

  return (
    <>
      <PageHeader
        title="Instructors"
        description="Instructors see and do only what their grants allow. To make someone an instructor, create the user (or change their role) first."
        actions={<ButtonLink to="/admin/users/new">New user</ButtonLink>}
      />
      <ErrorBanner error={grants.error} onRetry={() => void grants.refetch()} />
      <Table
        caption="Instructors"
        columns={columns}
        rows={instructors.rows}
        rowKey={(u) => u.id}
        loading={instructors.isPending}
        error={instructors.error}
        onRetry={() => void instructors.refetch()}
        empty={{ title: "No instructors yet", hint: "Create a user with the Instructor role." }}
        more={{
          hasMore: !!instructors.hasNextPage,
          loading: instructors.isFetchingNextPage,
          onMore: () => void instructors.fetchNextPage(),
        }}
      />
    </>
  );
}

export function InstructorDetail() {
  const { id = "" } = useParams();
  const user = useUser(id);
  const grants = useGrants(id);
  const names = useScopeNames();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [editing, setEditing] = useState<Grant | "new" | null>(null);
  const [deleting, setDeleting] = useState<Grant | null>(null);
  usePageTitle(user.data?.fullName ?? "Instructor");

  if (user.isPending) return <Loading />;
  if (user.error) return <QueryErrorPage error={user.error} />;
  const u = user.data;
  const refresh = () => queryClient.invalidateQueries({ queryKey: qk.grants });

  if (u.role !== "INSTRUCTOR")
    return (
      <Card>
        <EmptyState title={`${u.fullName} is not an instructor`}>
          Only instructors receive grants.{" "}
          <Link to={`/admin/users/${u.id}`} className="text-teal-700 underline">
            Open the user
          </Link>{" "}
          to change the role.
        </EmptyState>
      </Card>
    );

  return (
    <>
      <PageHeader
        title={u.fullName}
        description={
          <>
            Instructor ·{" "}
            <Link to={`/admin/users/${u.id}`} className="text-teal-700 hover:underline">
              account details
            </Link>
          </>
        }
        actions={<Button onClick={() => setEditing("new")}>Grant access</Button>}
      />
      {grants.isPending && <Loading />}
      <ErrorBanner error={grants.error} onRetry={() => void grants.refetch()} />
      {grants.data && !grants.data.length && (
        <EmptyState title="No access yet">This instructor sees nothing until you grant access.</EmptyState>
      )}
      <ul className="space-y-3" aria-label="Grants">
        {grants.data?.map((g) => (
          <li key={g.id}>
            <Card>
              <div className="flex flex-wrap items-start justify-between gap-3">
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
              </div>
            </Card>
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
    </>
  );
}
