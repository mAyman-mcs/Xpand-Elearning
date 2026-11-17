import type { Material } from "@contracts";
import { useMutation } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { ConfirmDialog } from "../../components/Dialog";
import { FormError, TextInput } from "../../components/form";
import { Table } from "../../components/Table";
import { useToast } from "../../components/Toast";
import { Button } from "../../components/ui";
import { api, errorMessage } from "../../lib/api";

/**
 * A list of training links (title + https link), with an Add form and Remove when `canEdit`.
 * Used for an exam's materials and for a category's materials.
 */
export function LinkEditor({
  caption,
  rows,
  loading,
  error,
  canEdit,
  onAdd,
  onChanged,
}: {
  caption: string;
  rows: Material[] | undefined;
  loading: boolean;
  error: unknown;
  canEdit: boolean;
  onAdd: (input: { title: string; url: string }) => Promise<unknown>;
  /** After an add or a remove: refetch the list. */
  onChanged: () => Promise<unknown>;
}) {
  const toast = useToast();
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [removing, setRemoving] = useState<Material | null>(null);

  const add = useMutation({
    mutationFn: () => onAdd({ title: title.trim(), url: url.trim() }),
    onSuccess: async () => {
      setTitle("");
      setUrl("");
      await onChanged();
      toast("Material added");
    },
  });
  const urlProblem = url && !/^https:\/\/\S+$/.test(url.trim()) ? "Use a full https:// link" : undefined;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (title.trim() && url.trim() && !urlProblem) add.mutate();
  };

  return (
    <>
      {canEdit && (
        <>
          <form onSubmit={submit} className="mb-4 grid gap-3 sm:grid-cols-[1fr_2fr_auto] sm:items-start">
            <TextInput label="Title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
            <TextInput
              label="Link"
              type="url"
              placeholder="https://…"
              value={url}
              error={urlProblem}
              onChange={(e) => setUrl(e.target.value)}
            />
            <Button
              type="submit"
              className="sm:mt-6"
              busy={add.isPending}
              disabled={!title.trim() || !url.trim() || !!urlProblem}
            >
              Add
            </Button>
          </form>
          <FormError message={add.error ? errorMessage(add.error) : null} />
        </>
      )}
      <Table
        caption={caption}
        rows={rows}
        rowKey={(m) => m.id}
        loading={loading}
        error={error}
        empty={{ title: "No material yet" }}
        columns={[
          {
            header: "Title",
            cell: (m) => (
              <a
                href={m.url}
                target="_blank"
                rel="noreferrer noopener"
                className="font-semibold text-brand-700 hover:underline"
              >
                {m.title}
              </a>
            ),
          },
          {
            header: "Link",
            cell: (m) => <span className="block max-w-xs truncate text-xs text-slate-600">{m.url}</span>,
          },
          ...(canEdit
            ? [
                {
                  header: "",
                  className: "text-right",
                  cell: (m: Material) => (
                    <Button size="sm" variant="ghost" onClick={() => setRemoving(m)} aria-label={`Remove ${m.title}`}>
                      Remove
                    </Button>
                  ),
                },
              ]
            : []),
        ]}
      />
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={`Remove “${removing?.title ?? ""}”?`}
        description="Students no longer see this link."
        confirmLabel="Remove"
        danger
        onConfirm={async () => {
          if (!removing) return;
          await api.materials.remove(removing.id);
          await onChanged();
          toast("Material removed");
        }}
      />
    </>
  );
}
