import type { Group } from "@contracts";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Link, useNavigate } from "react-router";
import { z } from "zod";
import { usePageTitle } from "../../app/pages";
import { Dialog } from "../../components/Dialog";
import { FormError, TextInput } from "../../components/form";
import { Table, type Column } from "../../components/Table";
import { Button, PageHeader } from "../../components/ui";
import { api } from "../../lib/api";
import { applyServerErrors } from "../../lib/forms";
import { qk } from "../../lib/query";
import { formatDate } from "../../lib/time";
import { useGroups } from "../users/queries";

export const groupSchema = z.object({
  name: z.string().trim().min(1, "Required").max(100),
  intakeStartDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date"),
});
export type GroupValues = z.infer<typeof groupSchema>;

export function GroupsList() {
  usePageTitle("Groups");
  const groups = useGroups();
  const [creating, setCreating] = useState(false);

  const columns: Column<Group>[] = [
    {
      header: "Group",
      cell: (g) => (
        <Link to={`/admin/groups/${g.id}`} className="font-semibold text-teal-700 hover:underline">
          {g.name}
        </Link>
      ),
    },
    { header: "Intake date", cell: (g) => formatDate(g.intakeStartDate) },
    { header: "Members", cell: (g) => g.memberCount, className: "text-right" },
  ];

  return (
    <>
      <PageHeader
        title="Groups"
        description="Cohorts or intakes. Schedules relative to the join date count from the intake date (or a late joiner's own date)."
        actions={<Button onClick={() => setCreating(true)}>New group</Button>}
      />
      <Table
        caption="Groups"
        columns={columns}
        rows={groups.data}
        rowKey={(g) => g.id}
        loading={groups.isPending}
        error={groups.error}
        onRetry={() => void groups.refetch()}
        empty={{ title: "No groups yet", hint: "Create the first intake with “New group”." }}
      />
      <NewGroupDialog open={creating} onOpenChange={setCreating} />
    </>
  );
}

function NewGroupDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<GroupValues>({
    resolver: zodResolver(groupSchema),
    defaultValues: { name: "", intakeStartDate: "" },
  });

  const create = useMutation({
    mutationFn: api.groups.create,
    onSuccess: async (g) => {
      await queryClient.invalidateQueries({ queryKey: qk.groups });
      onOpenChange(false);
      form.reset();
      void navigate(`/admin/groups/${g.id}`);
    },
    onError: (e) =>
      setFormError(
        applyServerErrors(e, form.setError, ["name", "intakeStartDate"], {
          CONFLICT: "A group with that name already exists.",
        }),
      ),
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          form.reset();
          setFormError(null);
        }
        onOpenChange(o);
      }}
      title="New group"
    >
      <form
        noValidate
        onSubmit={(e) => {
          setFormError(null);
          void form.handleSubmit((v) => create.mutate(v))(e);
        }}
        className="space-y-4"
      >
        <FormError message={formError} />
        <TextInput label="Name" required error={form.formState.errors.name?.message} {...form.register("name")} />
        <TextInput
          label="Intake date"
          type="date"
          required
          hint="The day the cohort starts."
          error={form.formState.errors.intakeStartDate?.message}
          {...form.register("intakeStartDate")}
        />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" busy={create.isPending}>
            Create group
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
