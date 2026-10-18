import type { Category, Tag } from "@contracts";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Link } from "react-router";
import { usePageTitle } from "../../app/pages";
import { ConfirmDialog, Dialog } from "../../components/Dialog";
import { Checkbox, FormError, TextInput } from "../../components/form";
import { Table, type Column } from "../../components/Table";
import { useToast } from "../../components/Toast";
import { Badge, Button, Card, PageHeader } from "../../components/ui";
import { api, errorMessage } from "../../lib/api";
import { qk } from "../../lib/query";
import { useCategories, useTags } from "./queries";

/** Super admins manage categories (one per exam) and tags (cross-cutting labels). */
export function CatalogPage() {
  usePageTitle("Categories & tags");
  return (
    <>
      <PageHeader
        title="Categories & tags"
        description="Every exam belongs to exactly one category; tags are extra labels. Instructors can be given access to a whole category."
      />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Categories />
        <Tags />
      </div>
    </>
  );
}

function useRefreshCatalog() {
  const queryClient = useQueryClient();
  return async () => {
    await queryClient.invalidateQueries({ queryKey: qk.categories });
    await queryClient.invalidateQueries({ queryKey: qk.tags });
    await queryClient.invalidateQueries({ queryKey: qk.exams });
  };
}

/** One-field "add" form used by both cards. */
function AddForm({ label, onAdd }: { label: string; onAdd: (name: string) => Promise<unknown> }) {
  const [name, setName] = useState("");
  // Clear the field only if it still holds what was added (the user may already be typing the next one).
  const add = useMutation({
    mutationFn: onAdd,
    onSuccess: (_result, added) => setName((current) => (current.trim() === added ? "" : current)),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (name.trim()) add.mutate(name.trim());
  };
  return (
    <form onSubmit={submit} className="mb-4 space-y-2">
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <TextInput label={label} value={name} onChange={(e) => setName(e.target.value)} maxLength={100} />
        </div>
        <Button type="submit" busy={add.isPending} disabled={!name.trim()}>
          Add
        </Button>
      </div>
      <FormError message={add.error ? errorMessage(add.error) : null} />
    </form>
  );
}

function RenameDialog({
  item,
  kind,
  onClose,
  onRename,
}: {
  item: { name: string } | null;
  kind: string;
  onClose: () => void;
  onRename: (name: string) => Promise<unknown>;
}) {
  const [name, setName] = useState<string | null>(null);
  const value = name ?? item?.name ?? "";
  const save = useMutation({
    mutationFn: () => onRename(value.trim()),
    onSuccess: () => close(),
  });
  const close = () => {
    setName(null);
    save.reset();
    onClose();
  };
  return (
    <Dialog
      open={item !== null}
      onOpenChange={(o) => !o && close()}
      title={`Rename ${kind}`}
      description="The link name (slug) stays the same, so nothing that refers to it breaks."
      footer={
        <>
          <Button variant="secondary" onClick={close}>
            Cancel
          </Button>
          <Button
            busy={save.isPending}
            disabled={!value.trim() || value.trim() === item?.name}
            onClick={() => save.mutate()}
          >
            Rename
          </Button>
        </>
      }
    >
      <TextInput label="New name" value={value} onChange={(e) => setName(e.target.value)} maxLength={100} />
      <FormError message={save.error ? errorMessage(save.error) : null} />
    </Dialog>
  );
}

function Categories() {
  const [showArchived, setShowArchived] = useState(false);
  const categories = useCategories(showArchived);
  const refresh = useRefreshCatalog();
  const toast = useToast();
  const [renaming, setRenaming] = useState<Category | null>(null);
  const [deleting, setDeleting] = useState<Category | null>(null);

  const setArchived = async (c: Category, archived: boolean) => {
    try {
      await api.categories.update(c.id, { archived });
      await refresh();
      toast(archived ? `“${c.name}” archived` : `“${c.name}” restored`);
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  };

  const columns: Column<Category>[] = [
    {
      header: "Category",
      cell: (c) => (
        <span>
          <span className="font-semibold">{c.name}</span> {c.archived && <Badge tone="amber">Archived</Badge>}
          <span className="block font-mono text-xs text-slate-600">{c.slug}</span>
        </span>
      ),
    },
    {
      header: "Exams",
      cell: (c) =>
        c.examCount ? (
          <Link to={`/exams?categoryId=${c.id}`} className="text-teal-700 hover:underline">
            {c.examCount}
          </Link>
        ) : (
          0
        ),
    },
    {
      header: "Actions",
      className: "text-right",
      cell: (c) => (
        <div className="flex justify-end gap-1">
          <Button size="sm" variant="ghost" onClick={() => setRenaming(c)} aria-label={`Rename ${c.name}`}>
            Rename
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void setArchived(c, !c.archived)}
            aria-label={`${c.archived ? "Restore" : "Archive"} ${c.name}`}
          >
            {c.archived ? "Restore" : "Archive"}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setDeleting(c)} aria-label={`Delete ${c.name}`}>
            Delete
          </Button>
        </div>
      ),
    },
  ];

  return (
    <Card title="Categories">
      <AddForm
        label="New category"
        onAdd={async (name) => {
          await api.categories.create({ name });
          await refresh();
          toast(`Category “${name}” added`);
        }}
      />
      <Checkbox
        className="mb-3"
        label="Show archived"
        checked={showArchived}
        onChange={(e) => setShowArchived(e.target.checked)}
      />
      <Table
        caption="Categories"
        columns={columns}
        rows={categories.data}
        rowKey={(c) => c.id}
        loading={categories.isPending}
        error={categories.error}
        empty={{ title: "No categories yet", hint: "Exams need a category: add one first." }}
      />
      <RenameDialog
        item={renaming}
        kind="category"
        onClose={() => setRenaming(null)}
        onRename={async (name) => {
          if (!renaming) return;
          await api.categories.update(renaming.id, { name });
          await refresh();
          toast("Category renamed");
        }}
      />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Delete “${deleting?.name ?? ""}”?`}
        description={
          deleting?.examCount
            ? `${deleting.examCount} exam(s) use this category, so it can't be deleted. Archive it instead: it disappears from pickers and keeps its exams.`
            : "This can't be undone."
        }
        confirmLabel="Delete"
        danger
        onConfirm={async () => {
          if (!deleting) return;
          await api.categories.remove(deleting.id);
          await refresh();
          toast("Category deleted");
        }}
      />
    </Card>
  );
}

function Tags() {
  const tags = useTags();
  const refresh = useRefreshCatalog();
  const toast = useToast();
  const [renaming, setRenaming] = useState<Tag | null>(null);
  const [deleting, setDeleting] = useState<Tag | null>(null);

  const columns: Column<Tag>[] = [
    {
      header: "Tag",
      cell: (t) => (
        <span>
          <span className="font-semibold">{t.name}</span>{" "}
          {(t.grantCount ?? 0) > 0 && (
            <Badge tone="blue">
              Access · {t.grantCount} grant{t.grantCount === 1 ? "" : "s"}
            </Badge>
          )}
          <span className="block font-mono text-xs text-slate-600">{t.slug}</span>
        </span>
      ),
    },
    { header: "Exams", cell: (t) => t.examCount ?? 0 },
    {
      header: "Actions",
      className: "text-right",
      cell: (t) => (
        <div className="flex justify-end gap-1">
          <Button size="sm" variant="ghost" onClick={() => setRenaming(t)} aria-label={`Rename ${t.name}`}>
            Rename
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setDeleting(t)} aria-label={`Delete ${t.name}`}>
            Delete
          </Button>
        </div>
      ),
    },
  ];

  return (
    <Card title="Tags">
      <AddForm
        label="New tag"
        onAdd={async (name) => {
          await api.tags.create(name);
          await refresh();
          toast(`Tag “${name}” added`);
        }}
      />
      <Table
        caption="Tags"
        columns={columns}
        rows={tags.data}
        rowKey={(t) => t.id}
        loading={tags.isPending}
        error={tags.error}
        empty={{ title: "No tags yet", hint: "Tags like “midterm” or “core” help filter and bulk-assign exams." }}
      />
      <RenameDialog
        item={renaming}
        kind="tag"
        onClose={() => setRenaming(null)}
        onRename={async (name) => {
          if (!renaming) return;
          await api.tags.rename(renaming.id, name);
          await refresh();
          toast("Tag renamed");
        }}
      />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Delete the tag “${deleting?.name ?? ""}”?`}
        description={
          (deleting?.grantCount ?? 0) > 0
            ? `“${deleting?.name ?? ""}” gives instructors access (${deleting?.grantCount ?? 0} grant(s)), so it can't be deleted. Remove it from those grants first.`
            : `It is removed from ${deleting?.examCount ?? 0} exam(s). The exams themselves are not changed otherwise.`
        }
        confirmLabel="Delete tag"
        danger
        onConfirm={async () => {
          if (!deleting) return;
          await api.tags.remove(deleting.id);
          await refresh();
          toast("Tag deleted");
        }}
      />
    </Card>
  );
}
