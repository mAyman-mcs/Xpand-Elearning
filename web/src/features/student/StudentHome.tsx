import type { StudentExamRow } from "@contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useAuth } from "../../app/auth";
import { usePageTitle } from "../../app/pages";
import { Dialog } from "../../components/Dialog";
import { Badge, ButtonLink, Button, Card, EmptyState, ErrorBanner, Loading, PageHeader } from "../../components/ui";
import { api } from "../../lib/api";
import { AVAILABILITY, PROGRESS } from "../../lib/labels";
import { qk } from "../../lib/query";
import { formatCountdown } from "../../lib/session";
import { formatInstant, formatMinutes } from "../../lib/time";

/** The current time, ticking every second (for countdowns). */
export function useNow(everyMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(t);
  }, [everyMs]);
  return now;
}

/** The next instant at which a row's status changes on its own (a window opening or closing). */
function nextChange(rows: StudentExamRow[], now: number): number | null {
  const times = rows
    .flatMap((r) => [r.status === "SCHEDULED" ? r.opensAt : null, r.status === "OPEN" ? r.closesAt : null])
    .filter((t): t is string => t !== null)
    .map((t) => Date.parse(t))
    .filter((t) => t > now);
  return times.length ? Math.min(...times) : null;
}

const ORDER: Record<StudentExamRow["status"], number> = {
  OPEN: 0,
  SCHEDULED: 1,
  EXTERNAL: 2,
  SUBMITTED: 3,
  MISSED: 4,
  CLOSED: 5,
  NOT_ASSIGNED: 6,
};

// The student dashboard (FRONTEND_GUIDE §4.2): what is open now, what comes next, what is done.
export function StudentHome() {
  usePageTitle("My exams");
  const { user } = useAuth();
  const client = useQueryClient();
  const exams = useQuery({ queryKey: qk.studentExams, queryFn: api.student.exams, staleTime: 15_000 });
  const now = useNow();

  // When a window opens or closes, ask the server again: it decides the status, not this clock.
  const change = exams.data ? nextChange(exams.data, now) : null;
  useEffect(() => {
    if (change === null) return;
    const t = setTimeout(() => void client.invalidateQueries({ queryKey: qk.studentExams }), change - Date.now() + 500);
    return () => clearTimeout(t);
  }, [change, client]);

  if (exams.isPending) return <Loading />;
  if (exams.error) return <ErrorBanner error={exams.error} onRetry={() => void exams.refetch()} />;

  const rows = [...exams.data].sort((a, b) => ORDER[a.status] - ORDER[b.status]);
  const count = (s: StudentExamRow["status"]) => rows.filter((r) => r.status === s).length;

  return (
    <>
      <PageHeader
        title={`Welcome back, ${user?.fullName.split(" ")[0] ?? ""}`}
        description="Your exams, their windows and your results."
      />
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Summary label="Open now" value={count("OPEN")} />
        <Summary label="Upcoming" value={count("SCHEDULED")} />
        <Summary label="Submitted" value={count("SUBMITTED")} />
        <Summary label="Missed" value={count("MISSED")} />
      </div>
      {rows.length === 0 ? (
        <EmptyState title="No exams yet">When an exam is assigned to you, it appears here.</EmptyState>
      ) : (
        <ul className="grid gap-4 lg:grid-cols-2" aria-label="My exams">
          {rows.map((row) => (
            <li key={row.exam.id}>
              <ExamCard row={row} now={now} />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function Summary({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-semibold tracking-wide text-slate-600 uppercase">{label}</p>
      <p className="mt-1 text-2xl font-extrabold text-slate-800">{value}</p>
    </div>
  );
}

function ExamCard({ row, now }: { row: StudentExamRow; now: number }) {
  const { exam, status, progress } = row;
  const tone = AVAILABILITY[status];
  const opensIn = status === "SCHEDULED" && row.opensAt ? Date.parse(row.opensAt) - now : null;
  const inProgress = progress === "IN_PROGRESS";

  return (
    <Card className="h-full">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-base font-bold text-slate-800">{exam.title}</h2>
          <p className="text-xs text-slate-600">
            {exam.code} · {exam.category.name} · {formatMinutes(exam.durationMinutes)}
          </p>
        </div>
        <Badge tone={inProgress ? "amber" : tone.tone}>{inProgress ? PROGRESS.IN_PROGRESS : tone.label}</Badge>
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
        {row.opensAt && (
          <div>
            <dt className="text-xs text-slate-600">Opens</dt>
            <dd className="text-slate-800">{formatInstant(row.opensAt)}</dd>
          </div>
        )}
        {row.closesAt && (
          <div>
            <dt className="text-xs text-slate-600">Closes</dt>
            <dd className="text-slate-800">{formatInstant(row.closesAt)}</dd>
          </div>
        )}
      </dl>

      {opensIn !== null && opensIn > 0 && (
        <p className="mt-3 text-sm text-slate-700">
          Opens in <span className="font-semibold tabular-nums">{formatCountdown(opensIn)}</span>
        </p>
      )}
      {status === "SUBMITTED" && (
        <p className="mt-3 text-sm text-slate-700">
          {row.result ? (
            <>
              Score: <span className="font-semibold">{row.result.score}</span> / {row.result.maxScore}
            </>
          ) : (
            "Submitted. Your result appears here once it is released."
          )}
        </p>
      )}
      {status !== "OPEN" && status !== "SUBMITTED" && status !== "SCHEDULED" && (
        <p className="mt-3 text-sm text-slate-600">{row.reason}</p>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {status === "OPEN" && !exam.isExternal && (
          <ButtonLink to={`/student/exams/${exam.id}`}>{inProgress ? "Resume exam" : "Start exam"}</ButtonLink>
        )}
        {exam.materials.map((m) => (
          <MaterialLink key={m.url} title={m.title} url={m.url} />
        ))}
      </div>
    </Card>
  );
}

function MaterialLink({ title, url }: { title: string; url: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        View: {title}
      </Button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title={title}
        wide
        footer={
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            download
            className="text-sm font-semibold text-teal-700 hover:underline"
          >
            Download / open in a new tab
          </a>
        }
      >
        <iframe title={title} src={url} className="h-[60vh] w-full rounded border border-slate-200" />
      </Dialog>
    </>
  );
}
