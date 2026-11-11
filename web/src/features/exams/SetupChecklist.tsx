import type { Exam } from "@contracts";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "react-router";
import { cx } from "../../components/ui";
import { api } from "../../lib/api";
import { qk } from "../../lib/query";

export interface SetupStep {
  key: "questions" | "assigned" | "published";
  label: string;
  done: boolean;
  /** What is missing, in a few words (only while not done). */
  detail?: string;
  /** Where to fix it, and the link's words. */
  to?: string;
  linkLabel?: string;
}

/**
 * The path from a new draft to "students can take it": questions ready, assigned, published.
 * An external exam has no questions; `assigned` is null when the caller can't see assignments.
 */
export function setupSteps(o: {
  examId: string;
  isExternal: boolean;
  publishProblems: string[] | undefined;
  assigned: boolean | null;
  published: boolean;
}): SetupStep[] {
  const steps: SetupStep[] = [];
  if (!o.isExternal)
    steps.push({
      key: "questions",
      label: "Questions ready",
      done: o.publishProblems !== undefined && o.publishProblems.length === 0,
      detail: o.publishProblems?.[0],
      to: `/exams/${o.examId}/questions`,
      linkLabel: "Fix them",
    });
  steps.push({
    key: "assigned",
    label: "Assigned to students",
    done: o.assigned === true,
    ...(o.assigned === null
      ? { detail: "Someone with the Assign permission does this." }
      : { detail: "No students or groups yet.", to: `/exams/${o.examId}/assignments`, linkLabel: "Choose students" }),
  });
  steps.push({
    key: "published",
    label: "Published",
    done: o.published,
    detail: "Students don't see drafts. Publish from the Status box on Settings.",
    to: `/exams/${o.examId}`,
    linkLabel: "Go to publishing",
  });
  return steps;
}

function Check({ done }: { done: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cx(
        "inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full",
        done ? "bg-brand-700 text-white" : "border-2 border-slate-300 bg-white",
      )}
    >
      {done && (
        <svg viewBox="0 0 16 16" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2.5">
          <path d="M3 8.5l3 3 7-7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </span>
  );
}

/**
 * On a draft exam, above every tab: what is left before students can take it. On a published exam
 * without assignments, one line saying so. Shown only to people who can edit the exam. Publishing
 * itself stays in one place, the Status box on the Settings tab.
 */
export function SetupChecklist({ exam, canAssign }: { exam: Exam; canAssign: boolean }) {
  const { pathname } = useLocation();
  const draft = exam.status === "DRAFT";
  const content = useQuery({
    queryKey: qk.questions(exam.id),
    queryFn: () => api.questions.list(exam.id),
    enabled: draft && !exam.isExternal,
  });
  const assignments = useQuery({
    queryKey: qk.assignments(exam.id),
    queryFn: () => api.assignments.list(exam.id),
    enabled: canAssign && exam.status !== "ARCHIVED",
  });

  const assigned = canAssign ? (assignments.data ? assignments.data.length > 0 : undefined) : null;

  if (exam.status === "PUBLISHED") {
    if (assigned !== false) return null;
    return (
      <p className="mb-6 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
        Published, but no student or group has it yet, so nobody can take it.{" "}
        <Link to={`/exams/${exam.id}/assignments`} className="font-semibold underline">
          Assign it
        </Link>
      </p>
    );
  }
  if (!draft || assigned === undefined || (!exam.isExternal && !content.data)) return null;

  const steps = setupSteps({
    examId: exam.id,
    isExternal: exam.isExternal,
    publishProblems: content.data?.publishProblems,
    assigned,
    published: false,
  });
  const done = steps.filter((s) => s.done).length;

  return (
    <section aria-labelledby="setup-title" className="mb-6 rounded-xl border border-brand-200 bg-brand-50/60 p-4">
      <h2 id="setup-title" className="text-sm font-bold text-slate-800">
        Getting this exam ready · {done} of {steps.length} done
      </h2>
      <ol className="mt-3 grid gap-3 sm:grid-cols-3">
        {steps.map((s) => (
          <li key={s.key} className="flex items-start gap-2 text-sm">
            <Check done={s.done} />
            <span>
              <span className={cx("block font-semibold", s.done ? "text-slate-600" : "text-slate-800")}>
                {s.label}
                <span className="sr-only">{s.done ? ": done" : ": to do"}</span>
              </span>
              {!s.done && (
                <span className="block text-xs text-slate-600">
                  {s.detail}{" "}
                  {s.to && s.to !== pathname && (
                    <Link to={s.to} className="font-semibold text-brand-700 hover:underline">
                      {s.linkLabel}
                    </Link>
                  )}
                </span>
              )}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
