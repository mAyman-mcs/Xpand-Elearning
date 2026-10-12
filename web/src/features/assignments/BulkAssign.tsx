import { useState } from "react";
import { useNavigate } from "react-router";
import { usePageTitle } from "../../app/pages";
import { Checkbox, SelectInput, TextInput } from "../../components/form";
import { useToast } from "../../components/Toast";
import { Card, cx, PageHeader } from "../../components/ui";
import type { ExamSelection } from "../../lib/api";
import { useAllExams, useCategories, useTags } from "../catalog/queries";
import { AssignForm } from "./AssignForm";

type Mode = "exams" | "category" | "tags";

/**
 * /assignments/new: several exams × several targets with one schedule. A one-time action, not a
 * live rule: exams added to the category later are not assigned (BACKEND_PLAN D8).
 */
export function BulkAssign() {
  usePageTitle("Assign several exams");
  const navigate = useNavigate();
  const toast = useToast();
  const exams = useAllExams();
  const categories = useCategories();
  const tags = useTags();
  const [mode, setMode] = useState<Mode>("category");
  const [examIds, setExamIds] = useState<string[]>([]);
  const [categoryId, setCategoryId] = useState("");
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [search, setSearch] = useState("");

  const selection: ExamSelection | null =
    mode === "exams"
      ? examIds.length
        ? { examIds }
        : null
      : mode === "category"
        ? categoryId
          ? { categoryId }
          : null
        : tagIds.length
          ? { tagIds }
          : null;

  const assignable = (exams.data ?? []).filter((e) => e.status !== "ARCHIVED");
  const shown = assignable.filter(
    (e) => !search.trim() || `${e.title} ${e.code}`.toLowerCase().includes(search.trim().toLowerCase()),
  );
  const toggle = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

  return (
    <>
      <PageHeader
        title="Assign several exams"
        description="One schedule for several exams and targets, created once (exams added to a category later are not included). All or nothing."
      />
      <Card>
        <AssignForm
          selection={selection}
          showExamInPreview
          onAssigned={(created) => {
            toast(`${created} assignment${created === 1 ? "" : "s"} created`);
            void navigate("/exams");
          }}
        >
          <fieldset className="space-y-3">
            <legend className="text-sm font-bold text-slate-800">Which exams</legend>
            <div className="grid gap-2 sm:grid-cols-3">
              {(
                [
                  ["category", "Every exam in a category"],
                  ["tags", "Exams with tags"],
                  ["exams", "Chosen exams"],
                ] as const
              ).map(([m, label]) => (
                <label
                  key={m}
                  className={cx(
                    "flex cursor-pointer items-center gap-2 rounded-lg border p-3 text-sm",
                    mode === m ? "border-teal-500 bg-teal-50" : "border-slate-200",
                  )}
                >
                  <input
                    type="radio"
                    name="exam-mode"
                    checked={mode === m}
                    onChange={() => setMode(m)}
                    className="accent-teal-600"
                  />
                  {label}
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
            {mode === "tags" && (
              <div className="flex flex-wrap gap-2">
                {tags.data?.map((t) => (
                  <Checkbox
                    key={t.id}
                    label={t.name}
                    checked={tagIds.includes(t.id)}
                    onChange={() => setTagIds(toggle(tagIds, t.id))}
                  />
                ))}
                {!tags.data?.length && <p className="text-sm text-slate-500">No tags yet.</p>}
              </div>
            )}
            {mode === "exams" && (
              <div className="space-y-2">
                <TextInput
                  label="Find exams"
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
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
        </AssignForm>
      </Card>
    </>
  );
}
