import type { Exam, MyPermissions, Permission } from "@contracts";
import { useQuery } from "@tanstack/react-query";
import { NavLink, Outlet, useOutletContext, useParams } from "react-router";
import { usePermissions } from "../../app/auth";
import { QueryErrorPage, usePageTitle } from "../../app/pages";
import { Badge, cx, Loading, PageHeader } from "../../components/ui";
import { api } from "../../lib/api";
import { EXAM_STATUS } from "../../lib/labels";
import { can } from "../../lib/permissions";
import { qk } from "../../lib/query";

export interface ExamContext {
  exam: Exam;
  /** May the caller (probably) do this on this exam? For showing controls only. */
  allowed: (permission: Permission) => boolean;
}

export const useExam = () => useOutletContext<ExamContext>();

interface Tab {
  to: string;
  label: string;
  show: (perms: MyPermissions | undefined, exam: Exam) => boolean;
}

// Tabs appear as their phase lands (docs/ADMIN_DASHBOARD_PLAN.md A5, A6).
const on = (p: MyPermissions | undefined, e: Exam, ...perms: Permission[]) =>
  perms.some((x) => can(p, x, { id: e.id, categoryId: e.category.id }));

export const EXAM_TABS: Tab[] = [
  { to: "", label: "Settings", show: () => true },
  { to: "assignments", label: "Assignments", show: (p, e) => on(p, e, "EXAM_ASSIGN", "EXAM_SCHEDULE") },
  { to: "overrides", label: "Open / close", show: (p, e) => on(p, e, "EXAM_ASSIGN", "EXAM_SCHEDULE") },
  { to: "availability", label: "Availability", show: () => true },
];

/** /exams/:id: the exam's header and tabs; each tab is a child route. */
export function ExamLayout() {
  const { id = "" } = useParams();
  const exam = useQuery({ queryKey: qk.exam(id), queryFn: () => api.exams.get(id) });
  const { data: perms } = usePermissions();
  usePageTitle(exam.data?.title ?? "Exam");

  if (exam.isPending) return <Loading />;
  if (exam.error) return <QueryErrorPage error={exam.error} />;
  const e = exam.data;
  const ref = { id: e.id, categoryId: e.category.id };
  const context: ExamContext = { exam: e, allowed: (p) => can(perms, p, ref) };

  return (
    <>
      <PageHeader
        title={e.title}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-mono">{e.code}</span>
            <span>· {e.category.name}</span>
            <Badge tone={EXAM_STATUS[e.status].tone}>{EXAM_STATUS[e.status].label}</Badge>
            {e.isExternal && <Badge tone="amber">External</Badge>}
          </span>
        }
      />
      <nav aria-label="Exam sections" className="mb-6 border-b border-slate-200">
        <ul className="-mb-px flex flex-wrap gap-1">
          {EXAM_TABS.filter((t) => t.show(perms, e)).map((t) => (
            <li key={t.label}>
              <NavLink
                to={t.to ? `/exams/${e.id}/${t.to}` : `/exams/${e.id}`}
                end
                className={({ isActive }) =>
                  cx(
                    "block border-b-2 px-4 py-2 text-sm font-semibold",
                    isActive
                      ? "border-teal-600 text-teal-700"
                      : "border-transparent text-slate-500 hover:text-slate-800",
                  )
                }
              >
                {t.label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
      <Outlet context={context} />
    </>
  );
}
