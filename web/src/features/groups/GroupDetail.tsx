import type { GroupDetail as Group, GroupMember, PersonRef } from "@contracts";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Link, useParams } from "react-router";
import { QueryErrorPage, usePageTitle } from "../../app/pages";
import { ConfirmDialog, Dialog } from "../../components/Dialog";
import { FormError, TextInput } from "../../components/form";
import { PersonPicker } from "../../components/PersonPicker";
import { Table, type Column } from "../../components/Table";
import { useToast } from "../../components/Toast";
import { Badge, Button, Card, Loading, PageHeader } from "../../components/ui";
import { api, errorMessage } from "../../lib/api";
import { applyServerErrors } from "../../lib/forms";
import { qk } from "../../lib/query";
import { formatDate } from "../../lib/time";
import { groupSchema, type GroupValues } from "./GroupsList";

export function GroupDetail() {
  const { id = "" } = useParams();
  const group = useQuery({ queryKey: qk.group(id), queryFn: () => api.groups.get(id) });
  usePageTitle(group.data?.name ?? "Group");
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<GroupMember | null>(null);
  const [removing, setRemoving] = useState<GroupMember | null>(null);
  const queryClient = useQueryClient();
  const toast = useToast();

  if (group.isPending) return <Loading />;
  if (group.error) return <QueryErrorPage error={group.error} />;
  const g = group.data;

  const updated = async (next?: Group) => {
    if (next) queryClient.setQueryData(qk.group(id), next);
    else await queryClient.invalidateQueries({ queryKey: qk.group(id) });
    await queryClient.invalidateQueries({ queryKey: qk.groups });
    await queryClient.invalidateQueries({ queryKey: qk.users });
  };

  const columns: Column<GroupMember>[] = [
    {
      header: "Student",
      cell: (m) => (
        <Link to={`/admin/users/${m.id}`} className="font-semibold text-teal-700 hover:underline">
          {m.fullName}
          <span className="block font-mono text-xs font-normal text-slate-500">{m.username}</span>
        </Link>
      ),
    },
    {
      header: "Join date",
      cell: (m) => (
        <span>
          {formatDate(m.effectiveJoinDate)}{" "}
          {m.joinDate ? (
            <Badge tone="amber">Late joiner</Badge>
          ) : (
            <span className="text-xs text-slate-500">(intake)</span>
          )}
        </span>
      ),
    },
    { header: "Status", cell: (m) => (m.isActive ? <Badge tone="green">Active</Badge> : <Badge>Deactivated</Badge>) },
    {
      header: "Actions",
      className: "text-right",
      cell: (m) => (
        <div className="flex justify-end gap-2">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setEditing(m)}
            aria-label={`Change join date of ${m.fullName}`}
          >
            Join date
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setRemoving(m)} aria-label={`Remove ${m.fullName}`}>
            Remove
          </Button>
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title={g.name}
        description={`Intake ${formatDate(g.intakeStartDate)} · ${g.memberCount} member${g.memberCount === 1 ? "" : "s"}`}
        actions={<Button onClick={() => setAdding(true)}>Add students</Button>}
      />
      <div className="space-y-6">
        <GroupForm group={g} onSaved={updated} />
        <Card title="Members">
          <Table
            caption="Members"
            columns={columns}
            rows={g.members}
            rowKey={(m) => m.id}
            empty={{ title: "No members yet", hint: "Add students with “Add students”." }}
          />
        </Card>
      </div>

      <AddMembersDialog
        open={adding}
        onOpenChange={setAdding}
        group={g}
        onAdded={async (next, count) => {
          await updated(next);
          toast(`${count} student${count === 1 ? "" : "s"} added`);
        }}
      />
      <JoinDateDialog member={editing} group={g} onClose={() => setEditing(null)} onSaved={updated} />
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(o) => !o && setRemoving(null)}
        title="Remove from the group?"
        description={`${removing?.fullName ?? ""} leaves ${g.name}. Exams assigned to the group stop applying to them; their attempts are kept.`}
        confirmLabel="Remove"
        danger
        onConfirm={async () => {
          if (!removing) return;
          await api.groups.removeMember(g.id, removing.id);
          await updated();
          toast(`${removing.fullName} removed`);
        }}
      />
    </>
  );
}

function GroupForm({ group: g, onSaved }: { group: Group; onSaved: (next?: Group) => Promise<void> }) {
  const toast = useToast();
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<GroupValues>({
    resolver: zodResolver(groupSchema),
    values: { name: g.name, intakeStartDate: g.intakeStartDate },
  });
  const save = useMutation({
    mutationFn: (v: GroupValues) => api.groups.update(g.id, v),
    onSuccess: async () => {
      await onSaved();
      toast("Group saved");
    },
    onError: (e) =>
      setFormError(
        applyServerErrors(e, form.setError, ["name", "intakeStartDate"], {
          CONFLICT: "A group with that name already exists.",
        }),
      ),
  });
  return (
    <Card title="Settings">
      <form
        noValidate
        onSubmit={(e) => {
          setFormError(null);
          void form.handleSubmit((v) => save.mutate(v))(e);
        }}
        className="grid gap-4 sm:grid-cols-3"
      >
        <div className="sm:col-span-3">
          <FormError message={formError} />
        </div>
        <TextInput label="Name" required error={form.formState.errors.name?.message} {...form.register("name")} />
        <TextInput
          label="Intake date"
          type="date"
          required
          hint="Changing it moves every relative schedule that counts from it."
          error={form.formState.errors.intakeStartDate?.message}
          {...form.register("intakeStartDate")}
        />
        <div className="flex items-start justify-end pt-6">
          <Button type="submit" busy={save.isPending} disabled={!form.formState.isDirty}>
            Save
          </Button>
        </div>
      </form>
    </Card>
  );
}

function AddMembersDialog({
  open,
  onOpenChange,
  group,
  onAdded,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  group: Group;
  onAdded: (next: Group, count: number) => Promise<void>;
}) {
  const [people, setPeople] = useState<PersonRef[]>([]);
  const [joinDate, setJoinDate] = useState("");
  const add = useMutation({
    mutationFn: () =>
      api.groups.addMembers(
        group.id,
        people.map((p) => p.id),
        joinDate || null,
      ),
    onSuccess: async (next) => {
      await onAdded(next, people.length);
      close();
    },
  });
  const close = () => {
    setPeople([]);
    setJoinDate("");
    add.reset();
    onOpenChange(false);
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => (o ? onOpenChange(true) : close())}
      title={`Add students to ${group.name}`}
      wide
      footer={
        <>
          <Button variant="secondary" onClick={close}>
            Cancel
          </Button>
          <Button busy={add.isPending} disabled={!people.length} onClick={() => add.mutate()}>
            Add {people.length || ""} student{people.length === 1 ? "" : "s"}
          </Button>
        </>
      }
    >
      <FormError message={add.error ? errorMessage(add.error) : null} />
      <PersonPicker
        label="Find students"
        role="STUDENT"
        selected={people}
        onChange={setPeople}
        excludeIds={new Set(group.members.map((m) => m.id))}
      />
      <TextInput
        label="Join date (late joiners only)"
        type="date"
        value={joinDate}
        onChange={(e) => setJoinDate(e.target.value)}
        hint={`Leave empty to use the intake date (${formatDate(group.intakeStartDate)}). Relative schedules count from this date.`}
      />
    </Dialog>
  );
}

function JoinDateDialog({
  member,
  group,
  onClose,
  onSaved,
}: {
  member: GroupMember | null;
  group: Group;
  onClose: () => void;
  onSaved: (next: Group) => Promise<void>;
}) {
  const [value, setValue] = useState<string | null>(null);
  const current = value ?? member?.joinDate ?? "";
  const save = useMutation({
    mutationFn: (joinDate: string | null) => api.groups.setMemberJoinDate(group.id, member?.id ?? "", joinDate),
    onSuccess: async (next) => {
      await onSaved(next);
      close();
    },
  });
  const close = () => {
    setValue(null);
    save.reset();
    onClose();
  };
  return (
    <Dialog
      open={member !== null}
      onOpenChange={(o) => !o && close()}
      title={`Join date of ${member?.fullName ?? ""}`}
      description={`Relative schedules for ${group.name} count from this date. Without one, the intake date (${formatDate(group.intakeStartDate)}) is used.`}
      footer={
        <>
          {member?.joinDate && (
            <Button variant="ghost" busy={save.isPending} onClick={() => save.mutate(null)}>
              Use the intake date
            </Button>
          )}
          <Button variant="secondary" onClick={close}>
            Cancel
          </Button>
          <Button busy={save.isPending} disabled={!current} onClick={() => save.mutate(current)}>
            Save
          </Button>
        </>
      }
    >
      <FormError message={save.error ? errorMessage(save.error) : null} />
      <TextInput label="Join date" type="date" value={current} onChange={(e) => setValue(e.target.value)} />
    </Dialog>
  );
}
