import type { Material } from "@contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { ConfirmDialog } from "../../components/Dialog";
import { FormError, TextInput } from "../../components/form";
import { Table } from "../../components/Table";
import { useToast } from "../../components/Toast";
import { Button, Card } from "../../components/ui";
import { api, errorMessage } from "../../lib/api";
import { qk } from "../../lib/query";
import { useExam } from "../exams/ExamLayout";

/** /exams/:id/materials: training material links shown to assigned students (view / download). */
export function ExamMaterials() {
  const { exam } = useExam();
  const materials = useQuery({ queryKey: qk.materials(exam.id), queryFn: () => api.materials.list(exam.id) });
  const queryClient = useQueryClient();
  const toast = useToast();
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [removing, setRemoving] = useState<Material | null>(null);

  const refresh = () => queryClient.invalidateQueries({ queryKey: qk.materials(exam.id) });
  const add = useMutation({
    mutationFn: () => api.materials.create(exam.id, { title: title.trim(), url: url.trim() }),
    onSuccess: async () => {
      setTitle("");
      setUrl("");
      await refresh();
      toast("Material added");
    },
  });
  const urlProblem = url && !/^https:\/\/\S+$/.test(url.trim()) ? "Use a full https:// link" : undefined;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (title.trim() && url.trim() && !urlProblem) add.mutate();
  };

  return (
    <Card title="Training material">
      <p className="mb-4 text-sm text-slate-500">
        Students the exam is assigned to see these links (Google Docs, PDFs, slides). Use links that students can open.
      </p>
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
      <Table
        caption="Materials"
        rows={materials.data}
        rowKey={(m) => m.id}
        loading={materials.isPending}
        error={materials.error}
        empty={{ title: "No material yet" }}
        columns={[
          {
            header: "Title",
            cell: (m) => (
              <a
                href={m.url}
                target="_blank"
                rel="noreferrer noopener"
                className="font-semibold text-teal-700 hover:underline"
              >
                {m.title}
              </a>
            ),
          },
          {
            header: "Link",
            cell: (m) => <span className="block max-w-xs truncate text-xs text-slate-500">{m.url}</span>,
          },
          {
            header: "",
            className: "text-right",
            cell: (m) => (
              <Button size="sm" variant="ghost" onClick={() => setRemoving(m)} aria-label={`Remove ${m.title}`}>
                Remove
              </Button>
            ),
          },
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
          await refresh();
          toast("Material removed");
        }}
      />
    </Card>
  );
}
