import type { Role } from "@contracts";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { useNavigate } from "react-router";
import { z } from "zod";
import { usePageTitle } from "../../app/pages";
import { SecretDialog } from "../../components/Dialog";
import { Checkbox, FormError, SelectInput, TextInput } from "../../components/form";
import { Button, ButtonLink, Card, PageHeader } from "../../components/ui";
import { api } from "../../lib/api";
import { applyServerErrors, blankToNull } from "../../lib/forms";
import { ROLE_LABEL } from "../../lib/labels";
import { qk } from "../../lib/query";
import { useGroups } from "./queries";

// Mirrors the server's rules (createUserBody) for instant feedback; the server still decides.
export const userFields = {
  fullName: z.string().trim().min(1, "Required").max(200),
  email: z.union([z.literal(""), z.email("Not a valid email")]),
  mobile: z.string().trim().max(30),
  role: z.enum(["STUDENT", "INSTRUCTOR", "SUPER_ADMIN"]),
  joinDate: z.string(),
};

const schema = z.object({
  username: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9._-]{3,50}$/, "3–50 characters: a-z, 0-9, dot, underscore, dash"),
  ...userFields,
  groupIds: z.array(z.string()),
});
type Values = z.infer<typeof schema>;

export function NewUser() {
  usePageTitle("New user");
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const groups = useGroups();
  const [formError, setFormError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ id: string; username: string; password: string } | null>(null);

  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { username: "", fullName: "", email: "", mobile: "", role: "STUDENT", joinDate: "", groupIds: [] },
  });
  const { register, handleSubmit, watch, formState } = form;
  const role = watch("role");

  const create = useMutation({
    mutationFn: (v: Values) =>
      api.users.create({
        username: v.username,
        fullName: v.fullName,
        email: blankToNull(v.email),
        mobile: blankToNull(v.mobile),
        role: v.role,
        joinDate: blankToNull(v.joinDate),
        groupIds: v.role === "STUDENT" ? v.groupIds : [],
      }),
    onSuccess: async (res) => {
      await queryClient.invalidateQueries({ queryKey: qk.users });
      await queryClient.invalidateQueries({ queryKey: qk.groups });
      setCreated({ id: res.user.id, username: res.user.username, password: res.temporaryPassword });
    },
    onError: (e) => {
      setFormError(
        applyServerErrors(
          e,
          form.setError,
          ["username", "fullName", "email", "mobile", "role", "joinDate", "groupIds"],
          {
            CONFLICT: "That username is already taken.",
          },
        ),
      );
    },
  });

  return (
    <>
      <PageHeader
        title="New user"
        description="The user gets a temporary password and must change it at first login."
      />
      <Card>
        <form
          noValidate
          onSubmit={(e) => {
            setFormError(null);
            void handleSubmit((v) => create.mutate(v))(e);
          }}
          className="grid gap-4 sm:grid-cols-2"
        >
          <div className="sm:col-span-2">
            <FormError message={formError} />
          </div>
          <TextInput
            label="Username"
            required
            autoComplete="off"
            hint="Used to sign in. a-z, 0-9, dot, underscore, dash."
            error={formState.errors.username?.message}
            {...register("username")}
          />
          <TextInput label="Full name" required error={formState.errors.fullName?.message} {...register("fullName")} />
          <TextInput label="Email" type="email" error={formState.errors.email?.message} {...register("email")} />
          <TextInput label="Mobile" error={formState.errors.mobile?.message} {...register("mobile")} />
          <SelectInput label="Role" required error={formState.errors.role?.message} {...register("role")}>
            {(Object.keys(ROLE_LABEL) as Role[]).map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]}
              </option>
            ))}
          </SelectInput>
          <TextInput
            label="Join date"
            type="date"
            hint="For personal schedules relative to the join date. Group schedules use the group's intake date."
            error={formState.errors.joinDate?.message}
            {...register("joinDate")}
          />
          {role === "STUDENT" && (
            <fieldset className="sm:col-span-2">
              <legend className="mb-2 text-sm font-semibold text-slate-700">Groups</legend>
              {groups.data?.length ? (
                <div className="grid gap-2 sm:grid-cols-3">
                  {groups.data.map((g) => (
                    <Checkbox key={g.id} label={g.name} value={g.id} {...register("groupIds")} />
                  ))}
                </div>
              ) : (
                <p className="text-sm text-slate-600">No groups yet.</p>
              )}
            </fieldset>
          )}
          {role !== "STUDENT" && (
            <p className="text-sm text-slate-600 sm:col-span-2">
              {role === "INSTRUCTOR"
                ? "Instructors see nothing until you give them access grants (Instructors page)."
                : "Super admins can do everything, including managing other admins."}
            </p>
          )}
          <div className="flex justify-end gap-2 sm:col-span-2">
            <ButtonLink to="/admin/users" variant="secondary">
              Cancel
            </ButtonLink>
            <Button type="submit" busy={create.isPending}>
              Create user
            </Button>
          </div>
        </form>
      </Card>
      <SecretDialog
        title="User created"
        description={`Give these credentials to ${created?.username ?? "the user"}. They must change the password at first login.`}
        secret={
          created
            ? [
                { label: "Username", value: created.username },
                { label: "Temporary password", value: created.password },
              ]
            : null
        }
        onClose={() => {
          const id = created?.id;
          setCreated(null);
          if (id) void navigate(`/admin/users/${id}`);
        }}
      />
    </>
  );
}
