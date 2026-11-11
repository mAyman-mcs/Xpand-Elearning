import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { useAuth } from "../../app/auth";
import { usePageTitle } from "../../app/pages";
import { cx, ErrorBanner, Loading, PageHeader } from "../../components/ui";
import { api } from "../../lib/api";
import { qk } from "../../lib/query";

export interface Stat {
  label: string;
  value: number;
  to?: string;
  /** Highlight numbers that need attention (locked accounts). */
  warn?: boolean;
  hint?: string;
}

// The super admin's start page (BE-1): what is happening today first, then what needs someone,
// then the academy's totals as a compact strip. Every number links to the list behind it.
export function Dashboard() {
  usePageTitle("Dashboard");
  const { user } = useAuth();
  const stats = useQuery({ queryKey: qk.stats, queryFn: api.admin.stats, staleTime: 0 });
  const s = stats.data;

  const today: Stat[] = s
    ? [
        { label: "Exams running now", value: s.today.examsRunning, hint: "Exams with a student in them right now." },
        { label: "Students in an exam", value: s.today.attemptsInProgress },
        {
          label: "Awaiting grading",
          value: s.today.awaitingGrading,
          to: "/submissions?show=awaiting-grading",
          warn: s.today.awaitingGrading > 0,
        },
        {
          label: "Submitted today",
          value: s.today.submittedToday,
          to: "/submissions",
          hint: "Since midnight, Cairo time.",
        },
      ]
    : [];
  // Only what has something to do in it.
  const attention: Stat[] = s
    ? [
        {
          label: "Locked accounts",
          value: s.attention.lockedAccounts,
          to: "/admin/users",
          warn: true,
          hint: "After 5 failed logins, for 15 minutes. A password reset unlocks.",
        },
        {
          label: "Published, not assigned",
          value: s.attention.publishedUnassigned,
          to: "/exams?status=PUBLISHED",
          warn: true,
          hint: "No student can see these exams yet.",
        },
      ].filter((a) => a.value > 0)
    : [];
  const totals: { title: string; items: Stat[] }[] = s
    ? [
        {
          title: "People",
          items: [
            { label: "Students", value: s.users.students, to: "/admin/users?role=STUDENT" },
            { label: "Instructors", value: s.users.instructors, to: "/admin/instructors" },
            { label: "Super admins", value: s.users.admins, to: "/admin/users?role=SUPER_ADMIN" },
            { label: "Deactivated", value: s.users.inactive, to: "/admin/users?includeInactive=true" },
            { label: "Groups", value: s.groups, to: "/admin/groups" },
            { label: "Signed in now", value: s.activeSessions },
          ],
        },
        {
          title: "Exams",
          items: [
            { label: "Published exams", value: s.exams.published, to: "/exams?status=PUBLISHED" },
            { label: "Draft exams", value: s.exams.draft, to: "/exams?status=DRAFT" },
            { label: "Archived exams", value: s.exams.archived, to: "/exams?status=ARCHIVED" },
            { label: "Assignments", value: s.assignments },
            { label: "Active open/close overrides", value: s.activeOverrides },
          ],
        },
      ]
    : [];

  return (
    <>
      <PageHeader
        title={`Welcome back, ${user?.fullName.split(" ")[0] ?? ""}.`}
        description="What is happening today, and what needs you. Select a number to open the list behind it."
      />
      {stats.isPending && <Loading />}
      <ErrorBanner error={stats.error} onRetry={() => void stats.refetch()} />
      {s && (
        <div className="space-y-8">
          <Section title="Today">
            <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {today.map((item) => (
                <li key={item.label}>
                  <StatCard {...item} />
                </li>
              ))}
            </ul>
          </Section>
          <Section title="Needs attention">
            {attention.length ? (
              <ul className="grid gap-4 sm:grid-cols-2">
                {attention.map((item) => (
                  <li key={item.label}>
                    <StatCard {...item} />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600">
                Nothing needs attention right now.
              </p>
            )}
          </Section>
          {totals.map((group) => (
            <Section key={group.title} title={group.title}>
              <ul className="flex flex-wrap gap-2">
                {group.items.map((item) => (
                  <li key={item.label}>
                    <StatChip {...item} />
                  </li>
                ))}
              </ul>
            </Section>
          ))}
        </div>
      )}
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const id = `stats-${title.replace(/\s+/g, "-").toLowerCase()}`;
  return (
    <section aria-labelledby={id}>
      <h2 id={id} className="mb-3 text-sm font-bold tracking-wide text-slate-600 uppercase">
        {title}
      </h2>
      {children}
    </section>
  );
}

/** A total in the compact strip: label and number on one line. */
function StatChip({ label, value, to }: Stat) {
  const body = (
    <>
      <span className="text-slate-600">{label}</span>{" "}
      <span className="font-bold text-slate-800 tabular-nums">{value}</span>
    </>
  );
  const box = "inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm";
  return to ? (
    <Link to={to} aria-label={`${label}: ${value}`} className={cx(box, "hover:border-brand-400")}>
      {body}
    </Link>
  ) : (
    <span className={box}>{body}</span>
  );
}

export function StatCard({ label, value, to, warn, hint }: Stat) {
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
        "transition hover:border-brand-400 hover:shadow",
      )}
    >
      {body}
    </Link>
  ) : (
    <div className={cx(box, "border-slate-200")}>{body}</div>
  );
}
