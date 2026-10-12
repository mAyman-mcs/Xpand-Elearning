import type { Role, UserDetail as User } from "@contracts";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Link, useParams } from "react-router";
import { z } from "zod";
import { useAuth } from "../../app/auth";
import { QueryErrorPage, usePageTitle } from "../../app/pages";
import { ConfirmDialog, SecretDialog } from "../../components/Dialog";
import { FormError, SelectInput, TextInput } from "../../components/form";
import { useToast } from "../../components/Toast";
import { Badge, Button, ButtonLink, Card, Loading, PageHeader } from "../../components/ui";
import { api, type UserPatch } from "../../lib/api";
import { applyServerErrors, blankToNull } from "../../lib/forms";
import { accountState, ROLE_LABEL, ROLE_TONE } from "../../lib/labels";
import { qk } from "../../lib/query";
import { formatDate, formatInstant } from "../../lib/time";
import { userFields } from "./NewUser";
import { useUser } from "./queries";

export function UserDetail({ mode }: { mode: "admin" | "instructor" }) {
  const { id = "" } = useParams();
  const user = useUser(id);
  usePageTitle(user.data?.fullName ?? "User");
  if (user.isPending) return <Loading />;
  if (user.error) return <QueryErrorPage error={user.error} />;
  const u = user.data;
  const state = accountState(u);

  return (
    <>
      <PageHeader
        title={u.fullName}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-mono">{u.username}</span>
            <Badge tone={ROLE_TONE[u.role]}>{ROLE_LABEL[u.role]}</Badge>
            <Badge tone={state.tone}>{state.label}</Badge>
          </span>
        }
      />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {mode === "admin" ? <DetailsForm user={u} /> : <ReadOnlyDetails user={u} />}
          <GroupsCard user={u} linkGroups={mode === "admin"} />
        </div>
        {mode === "admin" && <AccountCard user={u} />}
      </div>
    </>
  );
}

function ReadOnlyDetails({ user: u }: { user: User }) {
  const rows: [string, string][] = [
    ["Email", u.email ?? "—"],
    ["Mobile", u.mobile ?? "—"],
    ["Join date", formatDate(u.joinDate)],
  ];
  return (
    <Card title="Details">
      <dl className="grid gap-3 sm:grid-cols-3">
        {rows.map(([k, v]) => (
          <div key={k}>
            <dt className="text-xs font-semibold text-slate-600 uppercase">{k}</dt>
            <dd className="text-sm">{v}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}

const detailsSchema = z.object(userFields);
type DetailsValues = z.infer<typeof detailsSchema>;

function DetailsForm({ user: u }: { user: User }) {
  const { user: me } = useAuth();
  const isSelf = me?.id === u.id;
  const queryClient = useQueryClient();
  const toast = useToast();
  const [formError, setFormError] = useState<string | null>(null);
  const [pendingRoleChange, setPendingRoleChange] = useState<UserPatch | null>(null);

  const form = useForm<DetailsValues>({
    resolver: zodResolver(detailsSchema),
    values: {
      fullName: u.fullName,
      email: u.email ?? "",
      mobile: u.mobile ?? "",
      role: u.role,
      joinDate: u.joinDate ?? "",
    },
  });
  const { register, handleSubmit, formState } = form;

  const save = useMutation({
    mutationFn: (patch: UserPatch) => api.users.update(u.id, patch),
    onSuccess: async (updated) => {
      queryClient.setQueryData(qk.user(u.id), updated);
      await queryClient.invalidateQueries({ queryKey: qk.users });
      toast("Changes saved");
    },
  });

  function submit(v: DetailsValues) {
    setFormError(null);
    const patch: UserPatch = {
      fullName: v.fullName,
      email: blankToNull(v.email),
      mobile: blankToNull(v.mobile),
      joinDate: blankToNull(v.joinDate),
      ...(v.role !== u.role ? { role: v.role } : {}),
    };
    if (patch.role) setPendingRoleChange(patch);
    else save.mutate(patch, { onError: showError });
  }

  const showError = (e: unknown) =>
    setFormError(applyServerErrors(e, form.setError, ["fullName", "email", "mobile", "role", "joinDate"]));

  return (
    <Card title="Details">
      <form noValidate onSubmit={(e) => void handleSubmit(submit)(e)} className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <FormError message={formError} />
        </div>
        <TextInput label="Full name" required error={formState.errors.fullName?.message} {...register("fullName")} />
        <TextInput label="Email" type="email" error={formState.errors.email?.message} {...register("email")} />
        <TextInput label="Mobile" error={formState.errors.mobile?.message} {...register("mobile")} />
        <TextInput label="Join date" type="date" error={formState.errors.joinDate?.message} {...register("joinDate")} />
        <SelectInput
          label="Role"
          disabled={isSelf}
          hint={isSelf ? "You can't change your own role." : "Changing the role signs the user out everywhere."}
          error={formState.errors.role?.message}
          {...register("role")}
        >
          {(Object.keys(ROLE_LABEL) as Role[]).map((r) => (
            <option key={r} value={r}>
              {ROLE_LABEL[r]}
            </option>
          ))}
        </SelectInput>
        <div className="flex items-end justify-end sm:col-span-1">
          <Button type="submit" busy={save.isPending} disabled={!formState.isDirty}>
            Save changes
          </Button>
        </div>
      </form>
      <ConfirmDialog
        open={pendingRoleChange !== null}
        onOpenChange={(open) => !open && setPendingRoleChange(null)}
        title="Change the role?"
        description={`${u.fullName} becomes ${pendingRoleChange?.role ? ROLE_LABEL[pendingRoleChange.role] : ""} and is signed out on every device.`}
        confirmLabel="Change role"
        // A failure stays visible inside the dialog (ConfirmDialog shows the error).
        onConfirm={() => (pendingRoleChange ? save.mutateAsync(pendingRoleChange) : Promise.resolve())}
      />
    </Card>
  );
}

function AccountCard({ user: u }: { user: User }) {
  const { user: me } = useAuth();
  const isSelf = me?.id === u.id;
  const queryClient = useQueryClient();
  const toast = useToast();
  const [confirmReset, setConfirmReset] = useState(false);
  const [confirmActive, setConfirmActive] = useState(false);
  const [secret, setSecret] = useState<string | null>(null);
  const state = accountState(u);

  const refresh = async (updated?: User) => {
    if (updated) queryClient.setQueryData(qk.user(u.id), updated);
    else await queryClient.invalidateQueries({ queryKey: qk.user(u.id) });
    await queryClient.invalidateQueries({ queryKey: qk.users });
  };

  return (
    <Card title="Account">
      <dl className="mb-4 space-y-2 text-sm">
        <div>
          <dt className="text-xs font-semibold text-slate-600 uppercase">Status</dt>
          <dd>
            <Badge tone={state.tone}>{state.label}</Badge>
            {state.label === "Locked" && (
              <span className="ml-2 text-xs text-slate-600">until {formatInstant(u.lockedUntil)}</span>
            )}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-semibold text-slate-600 uppercase">Password</dt>
          <dd>{u.mustChangePassword ? "Temporary (must change at next login)" : "Set by the user"}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold text-slate-600 uppercase">Created</dt>
          <dd>{formatInstant(u.createdAt)}</dd>
        </div>
      </dl>
      <div className="flex flex-col gap-2">
        <Button variant="secondary" onClick={() => setConfirmReset(true)}>
          Reset password
        </Button>
        <ButtonLink to={`/admin/audit?entityType=User&entityId=${u.id}`} variant="ghost">
          View history
        </ButtonLink>
        <Button
          variant={u.isActive ? "danger" : "secondary"}
          disabled={isSelf}
          title={isSelf ? "You can't deactivate yourself." : undefined}
          onClick={() => setConfirmActive(true)}
        >
          {u.isActive ? "Deactivate" : "Reactivate"}
        </Button>
      </div>

      <ConfirmDialog
        open={confirmReset}
        onOpenChange={setConfirmReset}
        title="Reset the password?"
        description={`${u.fullName} gets a new temporary password, is unlocked, and is signed out everywhere.`}
        confirmLabel="Reset password"
        onConfirm={async () => {
          const res = await api.users.resetPassword(u.id);
          await refresh();
          setSecret(res.temporaryPassword);
        }}
      />
      <ConfirmDialog
        open={confirmActive}
        onOpenChange={setConfirmActive}
        title={u.isActive ? "Deactivate this account?" : "Reactivate this account?"}
        description={
          u.isActive
            ? `${u.fullName} can no longer sign in and is signed out everywhere. Their data is kept.`
            : `${u.fullName} can sign in again.`
        }
        confirmLabel={u.isActive ? "Deactivate" : "Reactivate"}
        danger={u.isActive}
        onConfirm={async () => {
          await refresh(await api.users.update(u.id, { isActive: !u.isActive }));
          toast(u.isActive ? "Account deactivated" : "Account reactivated");
        }}
      />
      <SecretDialog
        title="Password reset"
        description={`Give this temporary password to ${u.fullName}. They must change it at the next login.`}
        secret={
          secret
            ? [
                { label: "Username", value: u.username },
                { label: "Temporary password", value: secret },
              ]
            : null
        }
        onClose={() => setSecret(null)}
      />
    </Card>
  );
}

function GroupsCard({ user: u, linkGroups }: { user: User; linkGroups: boolean }) {
  return (
    <Card title="Groups">
      {u.groups.length ? (
        <ul className="divide-y divide-slate-100">
          {u.groups.map((g) => (
            <li key={g.id} className="flex items-center justify-between py-2 text-sm">
              {linkGroups ? (
                <Link to={`/admin/groups/${g.id}`} className="font-semibold text-teal-700 hover:underline">
                  {g.name}
                </Link>
              ) : (
                <span className="font-semibold">{g.name}</span>
              )}
              <span className="text-slate-600">
                {g.joinDate ? `Joined late: ${formatDate(g.joinDate)}` : "From intake"}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-slate-600">
          Not in any group.{linkGroups && u.role === "STUDENT" ? " Add the student from a group's page." : ""}
        </p>
      )}
    </Card>
  );
}
