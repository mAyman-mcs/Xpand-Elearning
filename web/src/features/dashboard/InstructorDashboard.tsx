import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { useAuth, usePermissions } from "../../app/auth";
import { usePageTitle } from "../../app/pages";
import { Card, ErrorBanner, Loading, PageHeader } from "../../components/ui";
import { api } from "../../lib/api";
import { hasAnyGrant, PERMISSION_LABELS } from "../../lib/permissions";
import { qk } from "../../lib/query";
import { formatInstant } from "../../lib/time";
import { SubmissionsTable } from "../submissions/SubmissionsTable";
import { StatCard, type Stat } from "./Dashboard";

const RECENT = 8;
const TO_GRADE = 5;

/**
 * /instructor: an instructor's own start page. Always available, grants or not: the numbers and
 * the latest submissions cover only what their grants reach (zero without any).
 */
export function InstructorDashboard() {
  usePageTitle("Dashboard");
  const { user } = useAuth();
  const { data: perms } = usePermissions();
  const stats = useQuery({ queryKey: qk.dashboard, queryFn: api.me.dashboard, staleTime: 0 });
  const recent = useQuery({
    queryKey: [...qk.submissions, "recent"],
    queryFn: () => api.submissions.list({}, undefined, RECENT),
    staleTime: 0,
  });
  // What needs this instructor today: attempts waiting for their grading, first on the page.
  const toGrade = useQuery({
    queryKey: [...qk.submissions, "awaiting", TO_GRADE],
    queryFn: () => api.submissions.list({ show: "awaiting-grading" }, undefined, TO_GRADE),
    staleTime: 0,
  });
  const granted = hasAnyGrant(perms);
  const s = stats.data;

  const cards: Stat[] = s
    ? [
        {
          label: "Awaiting grading",
          value: s.submissions.awaitingGrading,
          to: "/submissions?show=awaiting-grading",
          warn: s.submissions.awaitingGrading > 0,
          hint: "Submitted exams that need your approval.",
        },
        { label: "Submitted this week", value: s.submissions.lastWeek, to: "/submissions" },
        { label: "All submissions", value: s.submissions.total, to: "/submissions" },
        { label: "Exams you can access", value: s.exams, ...(granted ? { to: "/exams" } : {}) },
        { label: "Students you can see", value: s.students, ...(granted ? { to: "/students" } : {}) },
      ]
    : [];

  return (
    <>
      <PageHeader
        title={`Welcome back, ${user?.fullName.split(" ")[0] ?? ""}.`}
        description="Your exams and your students' submissions at a glance."
      />

      {perms && !granted && (
        <p className="mb-6 rounded-lg border border-sky-200 bg-sky-50 p-4 text-sm text-sky-900">
          You don't have access to any exams yet, so there is nothing to show. A super admin can give you access; this
          dashboard fills in as soon as they do.
        </p>
      )}

      {!!toGrade.data?.items.length && (
        <Card
          title={`Waiting for grading (${s?.submissions.awaitingGrading ?? toGrade.data.items.length})`}
          actions={
            <Link
              to="/submissions?show=awaiting-grading"
              className="text-sm font-semibold text-brand-700 hover:underline"
            >
              See all waiting
            </Link>
          }
          className="mb-8 border-2 border-amber-300"
        >
          <SubmissionsTable
            rows={toGrade.data.items}
            loading={false}
            error={null}
            onRetry={() => void toGrade.refetch()}
            empty={{ title: "Nothing to grade" }}
          />
        </Card>
      )}

      {stats.isPending && <Loading />}
      <ErrorBanner error={stats.error} onRetry={() => void stats.refetch()} />
      {s && (
        <ul className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-label="Your numbers">
          {cards.map((c) => (
            <li key={c.label}>
              <StatCard {...c} />
            </li>
          ))}
        </ul>
      )}

      <Card
        title="Latest submissions"
        actions={
          <Link to="/submissions" className="text-sm font-semibold text-brand-700 hover:underline">
            See all submissions
          </Link>
        }
        className="mb-8"
      >
        <SubmissionsTable
          rows={recent.data?.items}
          loading={recent.isPending}
          error={recent.error}
          onRetry={() => void recent.refetch()}
          empty={{
            title: "No submissions yet",
            hint: "When your students submit an exam, it appears here with a Preview link.",
          }}
        />
      </Card>

      {perms && granted && perms.role === "INSTRUCTOR" && (
        <Card title="Your access">
          <ul className="space-y-1 text-sm text-slate-700" aria-label="Your access">
            {perms.grants.map((g, i) => (
              <li key={i}>
                {g.permissions.map((p) => PERMISSION_LABELS[p]).join(", ")}
                <span className="text-slate-600">
                  {" "}
                  · {g.allExams ? "all exams" : "some exams"} ·{" "}
                  {g.allGroups ? "all students" : g.studentsWhoSubmitted ? "students who submitted" : "some groups"}
                  {g.expiresAt && ` · until ${formatInstant(g.expiresAt)}`}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}
