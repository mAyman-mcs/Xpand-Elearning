import type { Category, Exam, Tag } from "@contracts";
import { zodResolver } from "@hookform/resolvers/zod";
import type { ReactNode } from "react";
import { useForm, type UseFormReturn } from "react-hook-form";
import { z } from "zod";
import { Checkbox, SelectInput, TextInput } from "../../components/form";
import { cx } from "../../components/ui";

// Mirrors the server's createExamBody / updateExamBody for instant feedback; the server decides.
// In Zod 4 a schema-level `error` applies to every issue, so it is limited to the wrong-type case
// (an empty or non-numeric input); the range checks keep their own messages.
const number = (min: number, max: number) =>
  z
    .number({ error: (issue) => (issue.code === "invalid_type" ? "Enter a number" : undefined) })
    .min(min, `At least ${min}`)
    .max(max, `At most ${max}`);
const int = (min: number, max: number) => number(min, max).int("Whole numbers only");
export const examSchema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9][A-Z0-9-]{1,30}$/, "2–31 characters: A–Z, 0–9 and dashes"),
  title: z.string().trim().min(1, "Required").max(200),
  categoryId: z.string().min(1, "Choose a category"),
  tagIds: z.array(z.string()),
  durationMinutes: int(1, 600),
  passMark: number(0, 100),
  weight: number(0, 100),
  maxAttempts: int(1, 10),
  strikeLimit: int(1, 20),
  questionsPerAttempt: int(1, 500).nullable(),
  isExternal: z.boolean(),
  allowBackNavigation: z.boolean(),
  shuffleQuestions: z.boolean(),
  shuffleOptions: z.boolean(),
  requireFullscreen: z.boolean(),
});
export type ExamValues = z.infer<typeof examSchema>;

export const NEW_EXAM: ExamValues = {
  code: "",
  title: "",
  categoryId: "",
  tagIds: [],
  durationMinutes: 45,
  passMark: 80,
  weight: 15,
  maxAttempts: 1,
  strikeLimit: 3,
  questionsPerAttempt: null,
  isExternal: false,
  allowBackNavigation: true,
  shuffleQuestions: true,
  shuffleOptions: true,
  requireFullscreen: true,
};

export function valuesOf(e: Exam): ExamValues {
  return {
    code: e.code,
    title: e.title,
    categoryId: e.category.id,
    tagIds: e.tags.map((t) => t.id),
    durationMinutes: e.durationMinutes,
    passMark: e.passMark,
    weight: e.weight,
    maxAttempts: e.maxAttempts,
    strikeLimit: e.strikeLimit,
    questionsPerAttempt: e.questionsPerAttempt,
    isExternal: e.isExternal,
    allowBackNavigation: e.allowBackNavigation,
    shuffleQuestions: e.shuffleQuestions,
    shuffleOptions: e.shuffleOptions,
    requireFullscreen: e.requireFullscreen,
  };
}

export function useExamForm(values: ExamValues) {
  return useForm<ExamValues>({ resolver: zodResolver(examSchema), values });
}

interface FieldsProps {
  form: UseFormReturn<ExamValues>;
  mode: "create" | "edit";
  categories: Category[];
  tags: Tag[];
  readOnly: boolean;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="space-y-3">
      <legend className="text-sm font-bold text-slate-800">{title}</legend>
      {children}
    </fieldset>
  );
}

/** The exam settings fields (FRONTEND_GUIDE §4.4 "Exams"), shared by "New exam" and the Settings tab. */
export function ExamFields({ form, mode, categories, tags, readOnly }: FieldsProps) {
  const { register, formState, watch, setValue } = form;
  const errors = formState.errors;
  const isExternal = watch("isExternal");
  const tagIds = watch("tagIds");
  const num = { valueAsNumber: true } as const;

  return (
    <fieldset disabled={readOnly} className="space-y-6">
      <Section title="Identity">
        <div className="grid gap-4 sm:grid-cols-2">
          <TextInput label="Title" required error={errors.title?.message} {...register("title")} />
          <TextInput
            label="Code"
            required
            disabled={mode === "edit"}
            hint={mode === "edit" ? "The code can't change." : "Short unique code, e.g. CLOUD-1."}
            error={errors.code?.message}
            {...register("code")}
          />
          <SelectInput
            label="Category"
            required
            hint={mode === "edit" ? "Moving an exam changes which instructors reach it." : undefined}
            error={errors.categoryId?.message}
            {...register("categoryId")}
          >
            <option value="">Choose…</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </SelectInput>
        </div>
        {tags.length > 0 && (
          <div>
            <p className="mb-1 text-sm font-semibold text-slate-700">Tags</p>
            <div className="flex flex-wrap gap-2">
              {tags.map((t) => {
                const on = tagIds.includes(t.id);
                return (
                  <button
                    key={t.id}
                    type="button"
                    aria-pressed={on}
                    onClick={() =>
                      setValue("tagIds", on ? tagIds.filter((x) => x !== t.id) : [...tagIds, t.id], {
                        shouldDirty: true,
                      })
                    }
                    className={cx(
                      "rounded-full border px-3 py-1 text-xs font-semibold disabled:opacity-60",
                      on
                        ? "border-teal-700 bg-teal-700 text-white"
                        : "border-slate-300 text-slate-600 hover:bg-slate-50",
                    )}
                  >
                    {t.name}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </Section>

      <Section title="Delivery">
        <Checkbox
          label="Taken outside the platform (e.g. CTF)"
          hint="Students see it as External; staff enter the scores."
          {...register("isExternal")}
        />
        <div className="grid gap-4 sm:grid-cols-3">
          <TextInput
            label="Duration (minutes)"
            type="number"
            required
            min={1}
            max={600}
            error={errors.durationMinutes?.message}
            {...register("durationMinutes", num)}
          />
          <TextInput
            label="Pass mark (%)"
            type="number"
            min={0}
            max={100}
            step="0.5"
            error={errors.passMark?.message}
            {...register("passMark", num)}
          />
          <TextInput
            label="Weight (% of the total)"
            type="number"
            min={0}
            max={100}
            step="0.5"
            hint="Technical topics 15 each, CTF 25."
            error={errors.weight?.message}
            {...register("weight", num)}
          />
          <TextInput
            label="Attempts allowed"
            type="number"
            min={1}
            max={10}
            error={errors.maxAttempts?.message}
            {...register("maxAttempts", num)}
          />
          <TextInput
            label="Questions per attempt"
            type="number"
            min={1}
            max={500}
            hint="Empty = all questions. Random draws come with question pools."
            error={errors.questionsPerAttempt?.message}
            {...register("questionsPerAttempt", {
              setValueAs: (v: string) => (v === "" || v === null ? null : Number(v)),
            })}
          />
        </div>
      </Section>

      {!isExternal && (
        <Section title="Exam session rules">
          <div className="grid gap-3 sm:grid-cols-2">
            <Checkbox label="Allow going back to earlier questions" {...register("allowBackNavigation")} />
            <Checkbox label="Shuffle the questions per student" {...register("shuffleQuestions")} />
            <Checkbox label="Shuffle the options per student" {...register("shuffleOptions")} />
            <Checkbox label="Require fullscreen" {...register("requireFullscreen")} />
          </div>
          <div className="max-w-xs">
            <TextInput
              label="Strikes before auto-submit"
              type="number"
              min={1}
              max={20}
              hint="Leaving fullscreen or switching tabs counts as a strike."
              error={errors.strikeLimit?.message}
              {...register("strikeLimit", num)}
            />
          </div>
        </Section>
      )}
    </fieldset>
  );
}
