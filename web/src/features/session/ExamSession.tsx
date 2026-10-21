import type { EventResult, StudentAttempt, StudentQuestion } from "@contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Navigate, useBlocker, useNavigate, useParams } from "react-router";
import { NotFound, usePageTitle } from "../../app/pages";
import { Dialog } from "../../components/Dialog";
import { Button, cx, ErrorBanner, Loading } from "../../components/ui";
import { api, ApiError } from "../../lib/api";
import { qk } from "../../lib/query";
import { clockOffset, formatCountdown, LOW_TIME_MS, remainingMs } from "../../lib/session";
import { enterFullscreen } from "../student/ExamBrief";
import { AnswerSaver, type SaveState } from "./saver";
import { useProctoring } from "./useProctoring";

const HEARTBEAT_MS = 10_000;

// The exam page (NEXT_PLAN F3), outside the app layout: one question at a time, autosave, the
// server's timer, and the anti-cheating listeners. Everything it shows comes from the server.
export function ExamSession() {
  const { attemptId = "" } = useParams();
  const attempt = useQuery({
    queryKey: qk.attempt(attemptId),
    queryFn: () => api.attempts.get(attemptId),
    staleTime: Infinity,
    gcTime: 0,
    retry: false,
  });

  if (attempt.isPending) return <Loading label="Loading your exam…" />;
  if (attempt.error) {
    const e = attempt.error;
    if (e instanceof ApiError && e.code === "ATTEMPT_SUBMITTED")
      return <Navigate to={`/exam/${attemptId}/done`} replace />;
    if (e instanceof ApiError && e.code === "ATTEMPT_IN_PROGRESS_ELSEWHERE") return <Elsewhere />;
    if (e instanceof ApiError && e.status === 404) return <NotFound />;
    return (
      <div className="mx-auto max-w-lg p-8">
        <ErrorBanner error={e} onRetry={() => void attempt.refetch()} />
      </div>
    );
  }
  return <Session initial={attempt.data} />;
}

function Elsewhere() {
  usePageTitle("Exam in progress elsewhere");
  return (
    <div className="mx-auto mt-16 max-w-lg rounded-xl border border-red-200 bg-white p-8 text-center shadow-sm">
      <h1 className="text-xl font-bold text-slate-800">This exam is open on another device</h1>
      <p className="mt-2 text-sm text-slate-600">
        You can only continue in the browser where you started it. This attempt was recorded as a violation. If you need
        help, contact your instructor.
      </p>
      <a href="/student" className="mt-6 inline-block text-sm font-semibold text-teal-700 hover:underline">
        Back to my exams
      </a>
    </div>
  );
}

type Ending = null | "submitting" | "time" | "ended";

function Session({ initial }: { initial: StudentAttempt }) {
  usePageTitle(initial.exam.title);
  const navigate = useNavigate();
  const client = useQueryClient();
  const id = initial.attemptId;
  const { exam } = initial;

  const [answers, setAnswers] = useState<Record<string, string[]>>(initial.answers);
  const [saveState, setSaveState] = useState<Record<string, { state: SaveState; message?: string }>>({});
  const [index, setIndex] = useState(exam.allowBackNavigation ? 0 : initial.furthestIndex);
  const [furthest, setFurthest] = useState(initial.furthestIndex);
  const [ending, setEnding] = useState<Ending>(null);
  const [elsewhere, setElsewhere] = useState(false);
  const [warning, setWarning] = useState<EventResult | null>(null);
  const [strikes, setStrikes] = useState(initial.strikes);
  const [offline, setOffline] = useState(false);
  const [confirmSubmit, setConfirmSubmit] = useState(false);
  const [confirmNext, setConfirmNext] = useState(false);
  const offset = useRef(clockOffset(initial.serverNow));
  const [now, setNow] = useState(() => Date.now());

  const live = ending === null && !elsewhere;

  // ─── Leaving: one way out, to the done page, replacing this entry so Back can't return ───
  const finish = useCallback(() => {
    setEnding((e) => e ?? "ended");
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    void client.invalidateQueries({ queryKey: qk.studentExams });
    void navigate(`/exam/${id}/done`, { replace: true });
  }, [client, id, navigate]);

  const saver = useMemo(
    () =>
      new AnswerSaver({
        save: (questionId, selected) => api.attempts.save(id, questionId, selected),
        onState: (questionId, state, message) => setSaveState((s) => ({ ...s, [questionId]: { state, message } })),
        onStop: (reason) => (reason === "elsewhere" ? setElsewhere(true) : finish()),
      }),
    [id, finish],
  );
  useEffect(() => () => saver.stop(), [saver]);

  const { fullscreen } = useProctoring({
    attemptId: id,
    active: live,
    onResult: (r) => {
      setStrikes(r.strikes);
      if (r.action === "WARN") setWarning(r);
      if (r.action === "AUTO_SUBMITTED" || r.action === "ENDED") finish();
    },
    onElsewhere: () => setElsewhere(true),
  });

  // ─── The clock: the server's deadline, shown with the server's time ───
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, []);
  const left = remainingMs(initial.deadlineAt, offset.current, now);

  // Time's up: send what's pending (the server accepts it for 5 s more), then wait for the server
  // to close the attempt.
  useEffect(() => {
    if (left !== 0 || ending !== null) return;
    setEnding("time");
    void saver.flush().then(async () => {
      for (let i = 0; i < 20; i++) {
        const hb = await api.attempts.heartbeat(id).catch(() => null);
        if (hb && !hb.active) break;
        await new Promise((r) => setTimeout(r, 2000));
      }
      finish();
    });
  }, [left, ending, saver, id, finish]);

  // ─── Heartbeat: proves the student is here; the server answers whether to go on ───
  useEffect(() => {
    if (!live) return;
    const beat = () =>
      api.attempts
        .heartbeat(id)
        .then((hb) => {
          setOffline(false);
          offset.current = clockOffset(hb.serverNow);
          setStrikes(hb.strikes);
          if (!hb.active) finish();
        })
        .catch((e: unknown) => {
          if (e instanceof ApiError && e.code === "ATTEMPT_IN_PROGRESS_ELSEWHERE") setElsewhere(true);
          else if (!(e instanceof ApiError) || e.status >= 500) setOffline(true);
        });
    const t = setInterval(beat, HEARTBEAT_MS);
    return () => clearInterval(t);
  }, [live, id, finish]);

  // ─── No copying, no printing; the page warns before closing ───
  useEffect(() => {
    document.body.classList.add("exam-active");
    return () => document.body.classList.remove("exam-active");
  }, []);
  useEffect(() => {
    if (!live) return;
    const onUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", onUnload);
    return () => window.removeEventListener("beforeunload", onUnload);
  }, [live]);
  const blocker = useBlocker(({ nextLocation }) => live && !nextLocation.pathname.endsWith("/done"));

  // ─── Questions ───
  const questions = initial.questions;
  const current = questions.find((q) => q.index === index) ?? questions[0];
  const answeredCount = Object.values(answers).filter((a) => a.length > 0).length;
  const unanswered = initial.questionCount - answeredCount;
  const isLast = index >= initial.questionCount - 1;

  const choose = (q: StudentQuestion, optionId: string, checked: boolean) => {
    if (!live) return;
    const before = answers[q.id] ?? [];
    const next =
      q.type === "MULTI_CHOICE"
        ? checked
          ? [...before.filter((o) => o !== optionId), optionId]
          : before.filter((o) => o !== optionId)
        : [optionId];
    setAnswers((a) => ({ ...a, [q.id]: next }));
    saver.set(q.id, next);
    if (!exam.allowBackNavigation && q.index > furthest) setFurthest(q.index);
  };

  const goNext = async () => {
    const target = index + 1;
    if (!exam.allowBackNavigation) {
      setConfirmNext(false);
      await api.attempts.moveTo(id, target).catch(() => undefined);
      setFurthest(target);
    }
    setIndex(target);
  };

  const submit = async () => {
    setEnding("submitting");
    await saver.flush();
    try {
      await api.attempts.submit(id);
    } catch (e) {
      if (e instanceof ApiError && e.code === "ATTEMPT_IN_PROGRESS_ELSEWHERE") return setElsewhere(true);
      if (!(e instanceof ApiError)) {
        setEnding(null);
        throw e;
      }
    }
    finish();
  };

  if (elsewhere) return <Elsewhere />;
  if (!current) return <Loading />;

  const low = left !== null && left < LOW_TIME_MS;
  const state = saveState[current.id];
  const pendingSaves = Object.values(saveState).some((s) => s.state === "saving" || s.state === "retrying");
  const needsFullscreen = exam.requireFullscreen && !fullscreen && live;

  return (
    <div className="exam-session relative min-h-screen bg-slate-50 select-none">
      <Watermark text={`${initial.student.fullName} · ${initial.student.username}`} />

      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="min-w-0">
            <h1 className="truncate text-base font-bold text-slate-800">{exam.title}</h1>
            <p className="text-xs text-slate-600">
              {exam.code} · {initial.student.fullName}
            </p>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-xs text-slate-600" aria-live="polite">
              Violations: {strikes} / {exam.strikeLimit}
            </span>
            {left !== null && (
              <span
                role="timer"
                aria-label="Time left"
                className={cx(
                  "rounded-lg px-3 py-1 font-mono text-lg font-bold tabular-nums",
                  low ? "bg-red-50 text-red-700" : "bg-slate-100 text-slate-800",
                )}
              >
                {formatCountdown(left)}
              </span>
            )}
          </div>
        </div>
        {offline && (
          <p role="status" className="bg-amber-50 px-4 py-1 text-center text-xs text-amber-800">
            Connection lost. Keep going: your answers are saved when it's back. The timer doesn't stop.
          </p>
        )}
      </header>

      <main className="mx-auto max-w-4xl px-4 py-6">
        {exam.allowBackNavigation && (
          <nav aria-label="Questions" className="mb-4 flex flex-wrap gap-1.5">
            {Array.from({ length: initial.questionCount }, (_, i) => {
              const q = questions.find((x) => x.index === i);
              const done = q ? (answers[q.id]?.length ?? 0) > 0 : false;
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => setIndex(i)}
                  aria-current={i === index ? "step" : undefined}
                  aria-label={`Question ${i + 1}${done ? ", answered" : ""}`}
                  className={cx(
                    "h-8 w-8 rounded-md text-xs font-semibold",
                    i === index
                      ? "bg-teal-700 text-white"
                      : done
                        ? "bg-teal-50 text-teal-800 ring-1 ring-teal-200"
                        : "bg-white text-slate-700 ring-1 ring-slate-200",
                  )}
                >
                  {i + 1}
                </button>
              );
            })}
          </nav>
        )}

        <section aria-labelledby="question-title" className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600">
            <span>
              Question {current.index + 1} of {initial.questionCount} · {current.points}{" "}
              {current.points === 1 ? "point" : "points"}
              {current.type === "MULTI_CHOICE" && " · choose all that apply"}
            </span>
            <SaveIndicator
              state={state?.state}
              message={state?.message}
              onRetry={() => saver.set(current.id, answers[current.id] ?? [])}
            />
          </div>
          <h2 id="question-title" className="text-lg font-semibold whitespace-pre-wrap text-slate-800">
            {current.text}
          </h2>
          {current.imageUrl && (
            <img
              src={current.imageUrl}
              alt=""
              className="mt-4 max-h-80 rounded border border-slate-200"
              draggable={false}
            />
          )}
          <fieldset className="mt-5 space-y-2">
            <legend className="sr-only">Options</legend>
            {current.options.map((o) => {
              const checked = (answers[current.id] ?? []).includes(o.id);
              return (
                <label
                  key={o.id}
                  className={cx(
                    "flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm",
                    checked ? "border-teal-600 bg-teal-50" : "border-slate-200 hover:bg-slate-50",
                  )}
                >
                  <input
                    type={current.type === "MULTI_CHOICE" ? "checkbox" : "radio"}
                    name={`q-${current.id}`}
                    className="mt-0.5 h-4 w-4"
                    checked={checked}
                    disabled={!live}
                    onChange={(e) => choose(current, o.id, e.target.checked)}
                  />
                  <span className="text-slate-800">{o.text}</span>
                </label>
              );
            })}
          </fieldset>
        </section>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            {exam.allowBackNavigation && index > 0 && (
              <Button variant="secondary" onClick={() => setIndex(index - 1)}>
                Previous
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            {!isLast && (
              <Button
                variant={isLast ? "secondary" : "primary"}
                disabled={!live}
                onClick={() => (exam.allowBackNavigation ? void goNext() : setConfirmNext(true))}
              >
                Next
              </Button>
            )}
            <Button variant={isLast ? "primary" : "secondary"} disabled={!live} onClick={() => setConfirmSubmit(true)}>
              Submit exam
            </Button>
          </div>
        </div>
        <p className="mt-3 text-xs text-slate-600">
          {answeredCount} of {initial.questionCount} answered{pendingSaves && " · saving…"}
        </p>
      </main>

      {/* ─── Dialogs and overlays ─── */}
      <Dialog
        open={confirmSubmit}
        onOpenChange={(o) => ending !== "submitting" && setConfirmSubmit(o)}
        title="Submit the exam?"
        description={
          unanswered > 0
            ? `${unanswered} of ${initial.questionCount} questions are not answered. You can't change your answers after submitting.`
            : "You can't change your answers after submitting."
        }
        footer={
          <>
            <Button variant="secondary" disabled={ending === "submitting"} onClick={() => setConfirmSubmit(false)}>
              Keep working
            </Button>
            <Button busy={ending === "submitting"} onClick={() => void submit()}>
              Submit
            </Button>
          </>
        }
      />
      <Dialog
        open={confirmNext}
        onOpenChange={setConfirmNext}
        title="Move to the next question?"
        description="In this exam you can't come back to a question once you move past it."
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmNext(false)}>
              Stay here
            </Button>
            <Button onClick={() => void goNext()}>Next question</Button>
          </>
        }
      />
      <Dialog
        open={warning !== null && live}
        onOpenChange={(o) => !o && setWarning(null)}
        title="Warning: violation recorded"
        description={
          warning
            ? `This is violation ${warning.strikes} of ${warning.strikeLimit}. At ${warning.strikeLimit} the exam is submitted automatically. Stay on this page${exam.requireFullscreen ? " in fullscreen" : ""}.`
            : undefined
        }
        footer={
          <Button
            onClick={() => {
              setWarning(null);
              if (exam.requireFullscreen) void enterFullscreen();
            }}
          >
            Return to the exam
          </Button>
        }
      />
      <Dialog
        open={blocker.state === "blocked"}
        onOpenChange={(o) => !o && blocker.reset?.()}
        title="Leave the exam?"
        description="The timer keeps running while you're away, and leaving counts as a violation. Submit the exam to finish it."
        footer={
          <>
            <Button variant="secondary" onClick={() => blocker.proceed?.()}>
              Leave anyway
            </Button>
            <Button onClick={() => blocker.reset?.()}>Stay in the exam</Button>
          </>
        }
      />
      {needsFullscreen && warning === null && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-slate-900/90 p-4">
          <div
            role="alertdialog"
            aria-labelledby="fs-title"
            className="max-w-md rounded-xl bg-white p-6 text-center shadow-2xl"
          >
            <h2 id="fs-title" className="text-lg font-bold text-slate-800">
              This exam runs in fullscreen
            </h2>
            <p className="mt-2 text-sm text-slate-600">
              Return to fullscreen to see the questions. The timer is running.
            </p>
            <Button className="mt-4" onClick={() => void enterFullscreen()}>
              Enter fullscreen
            </Button>
          </div>
        </div>
      )}
      {ending === "time" && (
        <div role="status" className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/90 p-4">
          <div className="rounded-xl bg-white p-6 text-center shadow-2xl">
            <h2 className="text-lg font-bold text-slate-800">Time is up</h2>
            <p className="mt-2 text-sm text-slate-600">Saving your last answers and submitting…</p>
          </div>
        </div>
      )}
    </div>
  );
}

function SaveIndicator({ state, message, onRetry }: { state?: SaveState; message?: string; onRetry: () => void }) {
  if (!state) return null;
  if (state === "failed")
    return (
      <span role="alert" className="flex items-center gap-2 font-semibold text-red-700">
        Not saved{message ? `: ${message}` : ""}
        <button type="button" className="underline" onClick={onRetry}>
          Retry
        </button>
      </span>
    );
  const text = { saving: "Saving…", retrying: "Connection problem, retrying…", saved: "Saved" }[state];
  return (
    <span role="status" className={state === "retrying" ? "text-amber-700" : "text-slate-600"}>
      {text}
    </span>
  );
}

/** The student's name across the page: a photo of the screen says who took it. */
function Watermark({ text }: { text: string }) {
  // A tiled SVG background, not text: decorative, so screen readers and contrast checks skip it.
  const safe = text.replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="420" height="220"><text x="20" y="130" transform="rotate(-25 210 110)" font-family="sans-serif" font-size="18" font-weight="700" fill="#0f172a" fill-opacity="0.07">${safe}</text></svg>`;
  return (
    <div
      aria-hidden="true"
      data-testid="watermark"
      data-text={text}
      className="pointer-events-none fixed inset-0 z-10"
      style={{ backgroundImage: `url("data:image/svg+xml,${encodeURIComponent(svg)}")` }}
    />
  );
}
