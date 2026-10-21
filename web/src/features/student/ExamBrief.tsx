import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { QueryErrorPage, usePageTitle } from "../../app/pages";
import { Badge, Button, Card, ErrorBanner, Loading, PageHeader } from "../../components/ui";
import { api } from "../../lib/api";
import { AVAILABILITY } from "../../lib/labels";
import { qk } from "../../lib/query";
import { formatInstant, formatMinutes } from "../../lib/time";

/** Asks for fullscreen; must run inside the click (browsers refuse it otherwise). Never throws. */
export async function enterFullscreen(): Promise<boolean> {
  if (document.fullscreenElement) return true;
  try {
    await document.documentElement.requestFullscreen({ navigationUI: "hide" });
    return true;
  } catch {
    return false;
  }
}

// The pre-check page (NEXT_PLAN F2): the rules of this exam, an agreement, then Start.
export function ExamBrief() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const client = useQueryClient();
  const brief = useQuery({ queryKey: qk.studentExam(id), queryFn: () => api.student.exam(id), staleTime: 0 });
  const [agreed, setAgreed] = useState(false);
  usePageTitle(brief.data?.exam.title ?? "Exam");

  const start = useMutation({
    mutationFn: async () => {
      if (brief.data?.exam.requireFullscreen) await enterFullscreen();
      return api.attempts.start(id);
    },
    onSuccess: (attempt) => {
      client.setQueryData(qk.attempt(attempt.attemptId), attempt);
      void client.invalidateQueries({ queryKey: qk.studentExams });
      void navigate(`/exam/${attempt.attemptId}`);
    },
    onError: () => {
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    },
  });

  if (brief.isPending) return <Loading />;
  if (brief.error) return <QueryErrorPage error={brief.error} />;
  const { exam, status } = brief.data;
  const resuming = brief.data.inProgressAttemptId !== null;
  const canStart = status === "OPEN" && !exam.isExternal;

  return (
    <div className="mx-auto max-w-3xl">
      <Link to="/student" className="text-sm font-semibold text-teal-700 hover:underline">
        ← My exams
      </Link>
      <PageHeader
        title={exam.title}
        description={`${exam.code} · ${exam.questionCount} questions · ${formatMinutes(exam.durationMinutes)}`}
        actions={<Badge tone={AVAILABILITY[status].tone}>{AVAILABILITY[status].label}</Badge>}
      />

      {!canStart && (
        <Card className="mb-4">
          <p className="text-sm text-slate-700">{brief.data.reason}</p>
          {brief.data.opensAt && status === "SCHEDULED" && (
            <p className="mt-1 text-sm text-slate-700">Opens {formatInstant(brief.data.opensAt)}.</p>
          )}
        </Card>
      )}

      <Card title="Before you start" className="mb-4">
        <ul className="list-disc space-y-2 pl-5 text-sm text-slate-700">
          <li>
            The timer starts when you press Start and <strong>never pauses</strong>, even if you close the page or lose
            your connection.
            {brief.data.closesAt && <> The exam window closes {formatInstant(brief.data.closesAt)}.</>}
          </li>
          <li>Your answers are saved as you go. When time runs out, the exam is submitted automatically.</li>
          <li>
            Use one device and one browser. Signing in elsewhere doesn't move the exam: it stays on the browser where
            you started it.
          </li>
          {exam.requireFullscreen && <li>The exam runs in fullscreen. Leaving fullscreen counts as a violation.</li>}
          <li>
            Switching tabs or windows, leaving fullscreen, or shrinking the window counts as a violation. After{" "}
            <strong>{exam.strikeLimit}</strong> violations the exam is submitted automatically.
          </li>
          <li>Copying, pasting, printing and screenshots are blocked and recorded.</li>
          {!exam.allowBackNavigation && (
            <li>
              <strong>You can't go back</strong> to a question once you move past it.
            </li>
          )}
          <li>Your name is shown on the exam screen.</li>
        </ul>
      </Card>

      {canStart && (
        <Card>
          <label className="flex items-start gap-3 text-sm text-slate-800">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4"
              checked={agreed}
              onChange={(e) => setAgreed(e.target.checked)}
            />
            I have read the rules and I agree to take this exam under them.
          </label>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Button disabled={!agreed} busy={start.isPending} onClick={() => start.mutate()}>
              {resuming ? "Resume exam" : "Start exam"}
            </Button>
            {exam.materials.length > 0 && (
              <span className="text-xs text-slate-600">Study materials are on your exams page.</span>
            )}
          </div>
          {start.error && (
            <div className="mt-3">
              <ErrorBanner error={start.error} />
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
