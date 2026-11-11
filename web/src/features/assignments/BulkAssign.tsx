import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { usePageTitle } from "../../app/pages";
import { Checkbox, SelectInput, TextInput } from "../../components/form";
import { useToast } from "../../components/Toast";
import { Card, cx, PageHeader } from "../../components/ui";
import type { ExamSelection } from "../../lib/api";
import { useAllExams, useCategories } from "../catalog/queries";
import { AssignForm } from "./AssignForm";
import { GiveTagForm, TagBundleTable } from "./TagBundles";

type Mode = "exams" | "category" | "tags";

/**
 * /assignments/new: several exams × several targets with one schedule. By category or by hand it is
 * a one-time action (exams added to the category later are not assigned, BACKEND_PLAN D8). By tag
 * it is live: the tag is given to groups, who then get every exam with it, now and later.
 */
export function BulkAssign() {
  usePageTitle("Assign several exams");
  const navigate = useNavigate();
  const toast = useToast();
  const exams = useAllExams();
  const categories = useCategories();
  const [params] = useSearchParams();
  const [mode, setMode] = useState<Mode>(params.get("mode") === "tags" ? "tags" : "category");
  const [examIds, setExamIds] = useState<string[]>([]);
  const [categoryId, setCategoryId] = useState("");
  const [search, setSearch] = useState("");

  const selection: ExamSelection | null =
    mode === "exams" ? (examIds.length ? { examIds } : null) : categoryId ? { categoryId } : null;

  const assignable = (exams.data ?? []).filter((e) => e.status !== "ARCHIVED");
  const shown = assignable.filter(
    (e) => !search.trim() || `${e.title} ${e.code}`.toLowerCase().includes(search.trim().toLowerCase()),
  );
  const toggle = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

  const chooser = (
    <fieldset className="space-y-3">
      <legend className="text-sm font-bold text-slate-800">Which exams</legend>
      <div className="grid gap-2 sm:grid-cols-3">
        {(
          [
            ["category", "Every exam in a category", "Once: exams added to it later are not included."],
            ["tags", "Every exam with a tag", "Stays up to date: exams tagged later are added."],
            ["exams", "Chosen exams", "Once, these exams only."],
          ] as const
        ).map(([m, label, help]) => (
          <label
            key={m}
            className={cx(
              "cursor-pointer rounded-lg border p-3 text-sm",
              mode === m ? "border-brand-500 bg-brand-50" : "border-slate-200",
            )}
          >
            <span className="flex items-center gap-2 font-semibold">
              <input
                type="radio"
                name="exam-mode"
                checked={mode === m}
                onChange={() => setMode(m)}
                className="accent-brand-600"
              />
              {label}
            </span>
            <span className="mt-1 block text-xs text-slate-600">{help}</span>
          </label>
        ))}
      </div>
      {mode === "category" && (
        <SelectInput label="Category" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
          <option value="">Choose…</option>
          {categories.data?.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} ({c.examCount ?? 0} exams)
            </option>
          ))}
        </SelectInput>
      )}
      {mode === "exams" && (
        <div className="space-y-2">
          <TextInput label="Find exams" type="search" value={search} onChange={(e) => setSearch(e.target.value)} />
          <div className="grid max-h-48 gap-1 overflow-y-auto rounded-lg border border-slate-200 p-2 sm:grid-cols-2">
            {shown.map((e) => (
              <Checkbox
                key={e.id}
                label={`${e.title} (${e.code})`}
                checked={examIds.includes(e.id)}
                onChange={() => setExamIds(toggle(examIds, e.id))}
              />
            ))}
          </div>
        </div>
      )}
    </fieldset>
  );

  return (
    <>
      <PageHeader
        title="Assign several exams"
        description="One schedule for several exams and groups or students. By tag, the group keeps getting every exam with that tag (e.g. all “SOC Part 1” exams)."
      />
      <div className="space-y-6">
        <Card>
          {mode === "tags" ? (
            <div className="space-y-6">
              {chooser}
              <GiveTagForm
                onGiven={(count) => toast(count === 1 ? "Tag given to 1 group" : `Tag given to ${count} groups`)}
              />
            </div>
          ) : (
            <AssignForm
              selection={selection}
              showExamInPreview
              onAssigned={(created) => {
                toast(`${created} assignment${created === 1 ? "" : "s"} created`);
                void navigate("/exams");
              }}
            >
              {chooser}
            </AssignForm>
          )}
        </Card>
        <Card title="Tags given to groups">
          <TagBundleTable />
        </Card>
      </div>
    </>
  );
}
