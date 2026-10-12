import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { useAuth } from "../../app/auth";
import { usePageTitle } from "../../app/pages";
import { cx, ErrorBanner, Loading, PageHeader } from "../../components/ui";
import { api } from "../../lib/api";
import { qk } from "../../lib/query";

interface Stat {
  label: string;
  value: number;
  to?: string;
  /** Highlight numbers that need attention (locked accounts). */
  warn?: boolean;
  hint?: string;
}

// The super admin's start page: live counts, each linking to the matching list (BE-1).
export function Dashboard() {
  usePageTitle("Dashboard");
  const { user } = useAuth();
  const stats = useQuery({ queryKey: qk.stats, queryFn: api.admin.stats, staleTime: 0 });

  const s = stats.data;
  const sections: { title: string; items: Stat[] }[] = s
    ? [
        {
          title: "People",
          items: [
            { label: "Students", value: s.users.students, to: "/admin/users?role=STUDENT" },
            { label: "Instructors", value: s.users.instructors, to: "/admin/instructors" },
            { label: "Super admins", value: s.users.admins, to: "/admin/users?role=SUPER_ADMIN" },
            { label: "Deactivated", value: s.users.inactive, to: "/admin/users?includeInactive=true" },
            {
              label: "Locked accounts",
              value: s.users.locked,
              to: "/admin/users",
              warn: s.users.locked > 0,
              hint: "After 5 failed logins, for 15 minutes. A password reset unlocks.",
            },
            { label: "Signed in now", value: s.activeSessions, hint: "Sessions active in the last 20 minutes." },
          ],
        },
        {
          title: "Exams",
          items: [
            { label: "Groups", value: s.groups, to: "/admin/groups" },
            { label: "Published exams", value: s.exams.published, to: "/exams?status=PUBLISHED" },
            { label: "Draft exams", value: s.exams.draft, to: "/exams?status=DRAFT" },
            { label: "Archived exams", value: s.exams.archived, to: "/exams?status=ARCHIVED" },
            { label: "Assignments", value: s.assignments, hint: "Exam × student or group." },
            { label: "Active open/close overrides", value: s.activeOverrides },
          ],
        },
      ]
    : [];

  return (
    <>
      <PageHeader
        title={`Welcome back, ${user?.fullName.split(" ")[0] ?? ""}.`}
        description="The academy at a glance. Select a number to open the list behind it."
      />
      {stats.isPending && <Loading />}
      <ErrorBanner error={stats.error} onRetry={() => void stats.refetch()} />
      <div className="space-y-8">
        {sections.map((section) => (
          <section key={section.title} aria-labelledby={`stats-${section.title}`}>
            <h2 id={`stats-${section.title}`} className="mb-3 text-sm font-bold tracking-wide text-slate-600 uppercase">
              {section.title}
            </h2>
            <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {section.items.map((item) => (
                <li key={item.label}>
                  <StatCard {...item} />
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </>
  );
}

function StatCard({ label, value, to, warn, hint }: Stat) {
  const body = (
    <>
      <span className="block text-sm font-medium text-slate-600">{label}</span>
      <span className={cx("mt-1 block text-3xl font-extrabold", warn ? "text-amber-600" : "text-slate-800")}>
        {value}
      </span>
      {hint && <span className="mt-1 block text-xs text-slate-600">{hint}</span>}
    </>
  );
  const box = "block h-full rounded-xl border bg-white p-5 shadow-sm";
  return to ? (
    <Link
      to={to}
      aria-label={`${label}: ${value}`}
      className={cx(
        box,
        warn ? "border-amber-300" : "border-slate-200",
        "transition hover:border-teal-400 hover:shadow",
      )}
    >
      {body}
    </Link>
  ) : (
    <div className={cx(box, "border-slate-200")}>{body}</div>
  );
}
