import type { Role, UserDetail } from "@contracts";
import { useState } from "react";
import { Link, useSearchParams } from "react-router";
import { usePageTitle } from "../../app/pages";
import { Checkbox, SelectInput, TextInput } from "../../components/form";
import { Table, type Column } from "../../components/Table";
import { Badge, ButtonLink, PageHeader } from "../../components/ui";
import { useDebounced } from "../../lib/forms";
import { accountState, ROLE_LABEL, ROLE_TONE } from "../../lib/labels";
import { formatDate } from "../../lib/time";
import { useGroups, useUsers } from "./queries";

/**
 * Super admins: everyone, with create/import. Instructors ("Students"): read-only, and the server
 * returns only students their grants reach.
 */
export function UsersList({ mode }: { mode: "admin" | "instructor" }) {
  const admin = mode === "admin";
  usePageTitle(admin ? "Users" : "Students");
  // Initial filters may come from the URL (dashboard cards link to e.g. ?role=STUDENT).
  const [params] = useSearchParams();
  const [search, setSearch] = useState("");
  const [role, setRole] = useState<Role | "">((params.get("role") as Role | null) ?? "");
  const [groupId, setGroupId] = useState(params.get("groupId") ?? "");
  const [includeInactive, setIncludeInactive] = useState(params.get("includeInactive") === "true");
  const q = useDebounced(search.trim());
  const groups = useGroups();
  const users = useUsers({
    q: q || undefined,
    role: role || undefined,
    groupId: groupId || undefined,
    includeInactive,
  });
  const base = admin ? "/admin/users" : "/students";

  const columns: Column<UserDetail>[] = [
    {
      header: "Name",
      cell: (u) => (
        <Link to={`${base}/${u.id}`} className="font-semibold text-teal-700 hover:underline">
          {u.fullName}
          <span className="block font-mono text-xs font-normal text-slate-500">{u.username}</span>
        </Link>
      ),
    },
    ...(admin
      ? [{ header: "Role", cell: (u: UserDetail) => <Badge tone={ROLE_TONE[u.role]}>{ROLE_LABEL[u.role]}</Badge> }]
      : []),
    { header: "Groups", cell: (u) => u.groups.map((g) => g.name).join(", ") || "—" },
    { header: "Join date", cell: (u) => formatDate(u.joinDate) },
    {
      header: "Status",
      cell: (u) => {
        const s = accountState(u);
        return <Badge tone={s.tone}>{s.label}</Badge>;
      },
    },
  ];

  return (
    <>
      <PageHeader
        title={admin ? "Users" : "Students"}
        description={admin ? "Students, instructors and super admins." : "Students in the groups your access covers."}
        actions={
          admin && (
            <>
              <ButtonLink to="/admin/users/import" variant="secondary">
                Import CSV
              </ButtonLink>
              <ButtonLink to="/admin/users/new">New user</ButtonLink>
            </>
          )
        }
      />
      <div className="mb-4 grid gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-2 lg:grid-cols-4">
        <TextInput
          label="Search"
          type="search"
          placeholder="Name or username"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {admin && (
          <SelectInput label="Role" value={role} onChange={(e) => setRole(e.target.value as Role | "")}>
            <option value="">All roles</option>
            {(Object.keys(ROLE_LABEL) as Role[]).map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]}
              </option>
            ))}
          </SelectInput>
        )}
        <SelectInput label="Group" value={groupId} onChange={(e) => setGroupId(e.target.value)}>
          <option value="">All groups</option>
          {groups.data?.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </SelectInput>
        <div className="flex items-end pb-2">
          <Checkbox
            label="Include deactivated"
            checked={includeInactive}
            onChange={(e) => setIncludeInactive(e.target.checked)}
          />
        </div>
      </div>
      <Table
        caption={admin ? "Users" : "Students"}
        columns={columns}
        rows={users.rows}
        rowKey={(u) => u.id}
        loading={users.isPending}
        error={users.error}
        onRetry={() => void users.refetch()}
        empty={{ title: "No users match", hint: search || role || groupId ? "Try other filters." : undefined }}
        more={{
          hasMore: !!users.hasNextPage,
          loading: users.isFetchingNextPage,
          onMore: () => void users.fetchNextPage(),
        }}
      />
    </>
  );
}
