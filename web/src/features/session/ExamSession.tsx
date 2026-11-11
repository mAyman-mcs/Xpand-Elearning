import type { EventResult, StudentAttempt, StudentQuestion } from "@contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Navigate, useBlocker, useNavigate, useParams } from "react-router";
import { NotFound, usePageTitle } from "../../app/pages";
import { Dialog } from "../../components/Dialog";
import { Picture } from "../../components/Picture";
import { Button, cx, ErrorBanner, Loading } from "../../components/ui";
import { api, ApiError, type AnswerInput } from "../../lib/api";
import { blocksOf, optionLetter, SHORT_ANSWER_MAX_CHARS } from "../../lib/questions";
import { qk } from "../../lib/query";
import {
  clockOffset,
  crossedWarning,
  formatCountdown,
  LOW_TIME_MS,
  remainingMs,
  SOON_TIME_MS,
  warningText,
  type ClientEvent,
} from "../../lib/session";
import { enterFullscreen } from "../student/ExamBrief";
import { QuestionMap } from "./QuestionMap";
import { AnswerSaver, type SaveState } from "./saver";
import { useProctoring } from "./useProctoring";

const HEARTBEAT_MS = 10_000;
/** How long a time warning stays on screen. */
const TIME_NOTICE_MS = 8_000;
/** How long a "that's turned off" notice stays, and the quiet time before the next one. */
const BLOCKED_NOTICE_MS = 3_000;
const BLOCKED_QUIET_MS = 10_000;
/** The essay counter appears near the limit only. */
const COUNTER_FROM = 0.8;

const BLOCKED_TEXT: Partial<Record<ClientEvent, string>> = {
  CLIPBOARD: "Copying and pasting are turned off during the exam.",
  CONTEXT_MENU: "Right-click is turned off during the exam.",
};

/** What the done page shows about the attempt (passed with the navigation; nothing is stored). */
export interface DoneState {
  answered: number;
  total: number;
}
/** Essays are saved after this pause in typing (and always before submitting). */
const TYPING_SAVE_MS = 1_500;
/** The server's limit for one essay answer. */
const ESSAY_MAX_CHARS = 10_000;

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
  const [essays, setEssays] = useState<Record<string, string>>(initial.essays);
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
  const [timeNotice, setTimeNotice] = useState<string | null>(null);
  const [blockedNotice, setBlockedNotice] = useState<string | null>(null);
  const lastBlockedAt = useRef(0);
  const offset = useRef(clockOffset(initial.serverNow));
  const [now, setNow] = useState(() => Date.now());
  /** Answered and total, for the done page (kept in a ref so `finish` stays stable). */
  const progress = useRef<DoneState>({ answered: 0, total: initial.questionCount });

  const live = ending === null && !elsewhere;

  // ─── Leaving: one way out, to the done page, replacing this entry so Back can't return ───
  const finish = useCallback(() => {
    setEnding((e) => e ?? "ended");
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    void client.invalidateQueries({ queryKey: qk.studentExams });
    void navigate(`/exam/${id}/done`, { replace: true, state: progress.current });
  }, [client, id, navigate]);

  const saver = useMemo(
    () =>
      new AnswerSaver<AnswerInput>({
        save: (questionId, answer) => api.attempts.save(id, questionId, answer),
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
    // Blocked actions are only logged: say so once in a while, so a habit (Ctrl+S, Ctrl+C) isn't a mystery.
    onBlocked: (type) => {
      const at = Date.now();
      if (at - lastBlockedAt.current < BLOCKED_QUIET_MS) return;
      lastBlockedAt.current = at;
      setBlockedNotice(
        `${BLOCKED_TEXT[type] ?? "That shortcut is turned off during the exam."} It doesn't count as a warning.`,
      );
    },
  });
  useEffect(() => {
    if (!blockedNotice) return;
    const t = setTimeout(() => setBlockedNotice(null), BLOCKED_NOTICE_MS);
    return () => clearTimeout(t);
  }, [blockedNotice]);

  // ─── The clock: the server's deadline, shown with the server's time ───
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, []);
  const left = remainingMs(initial.deadlineAt, offset.current, now);

  // ─── Time warnings at 10, 5 and 1 minute: shown, and announced to screen readers ───
  const previousLeft = useRef<number | null>(null);
  useEffect(() => {
    const crossed = crossedWarning(previousLeft.current, left);
    previousLeft.current = left;
    if (crossed !== null) setTimeNotice(warningText(crossed));
  }, [left]);
  useEffect(() => {
    if (!timeNotice) return;
    const t = setTimeout(() => setTimeNotice(null), TIME_NOTICE_MS);
    return () => clearTimeout(t);
  }, [timeNotice]);

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

  // ─── Questions, one screen per block: a case with all its questions, or a question on its own ───
  const questions = initial.questions;
  const blocks = useMemo(() => blocksOf([...initial.questions].sort((a, b) => a.index - b.index)), [initial.questions]);
  const screen = blocks.find((b) => b.some((q) => q.index === index)) ?? blocks[0];
  const current = screen?.[0];
  const lastOfScreen = screen?.at(-1);
  const caseOf = (q: StudentQuestion) => initial.cases.find((c) => c.id === q.caseId) ?? null;
  const screenCase = current ? caseOf(current) : null;
  const answeredCount =
    Object.values(answers).filter((a) => a.length > 0).length +
    Object.values(essays).filter((t) => t.trim().length > 0).length;
  const unanswered = initial.questionCount - answeredCount;
  const unansweredEssays = questions.filter((q) => q.type === "ESSAY" && !essays[q.id]?.trim()).length;
  const isAnswered = (q: StudentQuestion) =>
    q.type === "ESSAY" ? (essays[q.id]?.trim().length ?? 0) > 0 : (answers[q.id]?.length ?? 0) > 0;
  const answerOf = (q: StudentQuestion): AnswerInput =>
    q.type === "ESSAY" ? { text: essays[q.id] ?? "" } : { selectedOptionIds: answers[q.id] ?? [] };
  const isLast = (lastOfScreen?.index ?? index) >= initial.questionCount - 1;
  const screenIndex = screen ? blocks.indexOf(screen) : 0;
  const screenUnanswered = screen?.filter((q) => !isAnswered(q)).length ?? 0;
  const allDone = unanswered === 0;
  progress.current = { answered: answeredCount, total: initial.questionCount };

  // Without going back, "Next" says so on the button; it only asks when this screen has blanks.
  const onNext = () => {
    if (exam.allowBackNavigation || screenUnanswered === 0) void goNext();
    else setConfirmNext(true);
  };

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
    saver.set(q.id, { selectedOptionIds: next });
    if (!exam.allowBackNavigation && q.index > furthest) setFurthest(q.index);
  };

  const write = (q: StudentQuestion, text: string) => {
    if (!live) return;
    setEssays((e) => ({ ...e, [q.id]: text }));
    saver.setLater(q.id, { text }, TYPING_SAVE_MS);
    if (!exam.allowBackNavigation && q.index > furthest) setFurthest(q.index);
  };

  const goNext = async () => {
    // The first question after this screen (a case is answered as a whole).
    const target = (lastOfScreen?.index ?? index) + 1;
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
  if (!current || !screen) return <Loading />;

  const low = left !== null && left < LOW_TIME_MS;
  const soon = left !== null && left < SOON_TIME_MS;
  const saveStates = Object.values(saveState).map((s) => s.state);
  const overallSave = saveStates.includes("failed")
    ? { text: "Some answers aren't saved", tone: "text-red-700 font-semibold" }
    : saveStates.includes("retrying")
      ? { text: "Connection problem, retrying…", tone: "text-amber-700" }
      : saveStates.includes("saving")
        ? { text: "Saving…", tone: "text-slate-600" }
        : saveStates.length
          ? { text: "All answers saved", tone: "text-slate-600" }
          : null;
  // A browser without fullscreen (iPhone Safari, an attempt resumed elsewhere) gets a banner, never an
  // overlay it could not leave while the timer runs.
  const fullscreenMissing = exam.requireFullscreen && !document.fullscreenEnabled;
  const needsFullscreen = exam.requireFullscreen && !fullscreen && live && !fullscreenMissing;

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
          <div className="flex flex-wrap items-center gap-4">
            <div className="min-w-36 text-sm">
              <p className="font-semibold text-slate-800">
                {answeredCount} of {initial.questionCount} answered
              </p>
              <div
                className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-200"
                role="progressbar"
                aria-label="Questions answered"
                aria-valuemin={0}
                aria-valuemax={initial.questionCount}
                aria-valuenow={answeredCount}
              >
                <div
                  className="h-full rounded-full bg-teal-600 transition-[width]"
                  style={{ width: `${(answeredCount / Math.max(1, initial.questionCount)) * 100}%` }}
                />
              </div>
              {overallSave && (
                <p role="status" className={cx("mt-0.5 text-xs", overallSave.tone)}>
                  {overallSave.text}
                </p>
              )}
            </div>
            {/* Only once there is something to say: a counter of zero warnings only makes students nervous. */}
            <span aria-live="polite" className={cx("text-sm font-semibold text-amber-800", strikes === 0 && "sr-only")}>
              {strikes > 0 && `${strikes} of ${exam.strikeLimit} warnings used`}
            </span>
            {left !== null && (
              <span
                role="timer"
                aria-label="Time left"
                className={cx(
                  "rounded-lg px-3 py-1 font-mono text-lg font-bold tabular-nums",
                  low ? "bg-red-50 text-red-700" : soon ? "bg-amber-50 text-amber-800" : "bg-slate-100 text-slate-800",
                )}
              >
                {formatCountdown(left)}
              </span>
            )}
          </div>
        </div>
        {timeNotice && (
          <p
            className={cx(
              "px-4 py-1.5 text-center text-sm font-semibold",
              low ? "bg-red-600 text-white" : "bg-amber-100 text-amber-900",
            )}
          >
            {timeNotice}
          </p>
        )}
        {fullscreenMissing && live && (
          <p role="status" className="bg-amber-50 px-4 py-1 text-center text-xs text-amber-800">
            This browser can&apos;t show the exam in fullscreen. Keep this page open and don&apos;t switch away from it.
          </p>
        )}
        {offline && (
          <p role="status" className="bg-amber-50 px-4 py-1 text-center text-xs text-amber-800">
            Connection lost. Keep going: your answers are saved when it's back. The timer doesn't stop.
          </p>
        )}
      </header>

      <main className="mx-auto max-w-4xl px-4 py-6">
        {exam.intro && (
          <details open={screenIndex === 0} className="mb-4 rounded-xl border border-slate-200 bg-white p-4 text-sm">
            <summary className="cursor-pointer font-semibold text-slate-800">Introduction</summary>
            <p className="mt-2 whitespace-pre-wrap text-slate-700">{exam.intro}</p>
          </details>
        )}

        <QuestionMap
          blocks={blocks}
          current={screen}
          allowBack={exam.allowBackNavigation}
          isAnswered={isAnswered}
          onOpen={setIndex}
        />

        <section
          aria-labelledby="screen-title"
          className="space-y-6 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6"
        >
          {screenCase && (
            <div className="rounded-lg border border-teal-200 bg-teal-50/50 p-4">
              <p className="mb-1 flex flex-wrap items-center gap-2 text-xs text-slate-600">
                {screenCase.label && (
                  <span className="rounded bg-teal-700 px-2 py-0.5 font-bold tracking-wide text-white">
                    {screenCase.label}
                  </span>
                )}
                <span>
                  Questions {current.index + 1}–{(lastOfScreen ?? current).index + 1} of {initial.questionCount}
                </span>
              </p>
              <h2 id="screen-title" className="text-lg font-bold text-slate-800">
                {screenCase.title}
              </h2>
              <p className="mt-2 text-sm font-semibold text-slate-700">Situation</p>
              <p className="mt-1 text-sm whitespace-pre-wrap text-slate-800">{screenCase.situation}</p>
              {screenCase.imageUrl && (
                <div className="mt-3">
                  <Picture src={screenCase.imageUrl} alt={screenCase.imageAlt} className="max-h-72" />
                </div>
              )}
              {screenCase.hint && (
                <p className="mt-3 text-sm text-amber-900">
                  <span className="font-semibold">Hint:</span> {screenCase.hint}
                </p>
              )}
            </div>
          )}
          {screen.map((q) => (
            <QuestionBlock
              key={q.id}
              q={q}
              total={initial.questionCount}
              titleId={screenCase ? undefined : "screen-title"}
              live={live}
              selected={answers[q.id] ?? []}
              text={essays[q.id] ?? ""}
              save={saveState[q.id]}
              onChoose={(optionId, checked) => choose(q, optionId, checked)}
              onWrite={(text) => write(q, text)}
              onRetry={() => saver.set(q.id, answerOf(q))}
            />
          ))}
        </section>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            {exam.allowBackNavigation && screenIndex > 0 && (
              <Button variant="secondary" onClick={() => setIndex(blocks[screenIndex - 1]![0]!.index)}>
                Previous
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            {!isLast && (
              <Button variant={allDone ? "secondary" : "primary"} disabled={!live} onClick={onNext}>
                {exam.allowBackNavigation ? "Next" : "Next (can't return)"}
              </Button>
            )}
            {/* Submitting is the main action on the last screen, or once everything is answered;
                before that it is a quiet "finish early" link, away from Next. */}
            {(isLast || allDone) && (
              <Button disabled={!live} onClick={() => setConfirmSubmit(true)}>
                Submit exam
              </Button>
            )}
          </div>
        </div>
        {!isLast && !allDone && (
          <p className="mt-6 text-right text-sm">
            <button
              type="button"
              disabled={!live}
              onClick={() => setConfirmSubmit(true)}
              className="font-semibold text-slate-600 underline hover:text-slate-800 disabled:no-underline disabled:opacity-60"
            >
              Finish early and submit
            </button>
          </p>
        )}
      </main>

      {/* ─── Short notices: time warnings are announced right away; blocked actions politely ─── */}
      <div aria-live="assertive" className="sr-only">
        {timeNotice}
      </div>
      {blockedNotice && (
        <div
          role="status"
          className="fixed bottom-4 left-1/2 z-40 w-[calc(100vw-2rem)] max-w-md -translate-x-1/2 rounded-lg bg-slate-800 px-4 py-3 text-center text-sm text-white shadow-lg"
        >
          {blockedNotice}
        </div>
      )}

      {/* ─── Dialogs and overlays ─── */}
      <Dialog
        open={confirmSubmit}
        onOpenChange={(o) => ending !== "submitting" && setConfirmSubmit(o)}
        title="Submit the exam?"
        description={
          unanswered > 0
            ? `${unanswered} of ${initial.questionCount} questions are not answered${
                unansweredEssays > 0 ? `, including ${unansweredEssays} essay${unansweredEssays > 1 ? "s" : ""}` : ""
              }. You can't change your answers after submitting.`
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
        title="Move on with blank answers?"
        description={`${screenUnanswered === 1 ? "A question on this screen is" : `${screenUnanswered} questions on this screen are`} not answered. In this exam you can't come back once you move on.`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmNext(false)}>
              Stay here
            </Button>
            <Button onClick={() => void goNext()}>Move on</Button>
          </>
        }
      />
      <Dialog
        open={warning !== null && live}
        onOpenChange={(o) => !o && setWarning(null)}
        title="Warning: you left the exam"
        description={
          warning
            ? `This is warning ${warning.strikes} of ${warning.strikeLimit}. At warning ${warning.strikeLimit} the exam is submitted automatically. Stay on this page${exam.requireFullscreen ? " in fullscreen" : ""}.`
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

/** One question of the current screen: its text and picture, then options (A, B, C…) or an answer box. */
function QuestionBlock({
  q,
  total,
  titleId,
  live,
  selected,
  text,
  save,
  onChoose,
  onWrite,
  onRetry,
}: {
  q: StudentQuestion;
  total: number;
  /** The screen's heading id, when this question is the screen (not part of a case). */
  titleId?: string;
  live: boolean;
  selected: string[];
  text: string;
  save?: { state: SaveState; message?: string };
  onChoose: (optionId: string, checked: boolean) => void;
  onWrite: (text: string) => void;
  onRetry: () => void;
}) {
  const essay = q.type === "ESSAY";
  const short = essay && q.answerSize === "SHORT";
  const max = short ? SHORT_ANSWER_MAX_CHARS : ESSAY_MAX_CHARS;
  const nearLimit = text.length >= max * COUNTER_FROM;
  const headingId = titleId ?? `q-title-${q.id}`;
  const pictureOptions = q.options.some((o) => o.imageUrl);
  return (
    <div role="group" aria-labelledby={headingId}>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600">
        <span>
          Question {q.index + 1} of {total} · {q.points} {q.points === 1 ? "point" : "points"}
          {q.type === "MULTI_CHOICE" && " · choose all that apply"}
          {essay && " · written answer, graded by staff"}
        </span>
        <SaveIndicator state={save?.state} message={save?.message} onRetry={onRetry} />
      </div>
      <h3 id={headingId} className="text-base font-semibold whitespace-pre-wrap text-slate-800 sm:text-lg">
        {q.text}
      </h3>
      {q.imageUrl && (
        <div className="mt-3">
          <Picture src={q.imageUrl} alt={q.imageAlt} className="max-h-80" />
        </div>
      )}
      {essay ? (
        <div className="mt-3">
          <label htmlFor={`essay-${q.id}`} className="sr-only">
            Your answer to question {q.index + 1}
          </label>
          {short ? (
            <input
              id={`essay-${q.id}`}
              type="text"
              maxLength={max}
              value={text}
              disabled={!live}
              onChange={(e) => onWrite(e.target.value)}
              aria-describedby={nearLimit ? `essay-count-${q.id}` : undefined}
              spellCheck
              autoComplete="off"
              className="w-full rounded-lg border border-slate-300 p-3 text-sm text-slate-800 outline-none select-text focus:ring-2 focus:ring-teal-500"
            />
          ) : (
            <textarea
              id={`essay-${q.id}`}
              rows={8}
              maxLength={max}
              value={text}
              disabled={!live}
              onChange={(e) => onWrite(e.target.value)}
              aria-describedby={nearLimit ? `essay-count-${q.id}` : undefined}
              spellCheck
              autoComplete="off"
              className="w-full rounded-lg border border-slate-300 p-3 text-sm text-slate-800 outline-none select-text focus:ring-2 focus:ring-teal-500"
            />
          )}
          {nearLimit && (
            <p id={`essay-count-${q.id}`} className="mt-1 text-right text-xs font-medium text-amber-800">
              {text.length.toLocaleString()} / {max.toLocaleString()} characters
            </p>
          )}
        </div>
      ) : (
        <fieldset className={cx("mt-3 gap-2", pictureOptions ? "grid sm:grid-cols-2" : "space-y-2")}>
          <legend className="sr-only">Options for question {q.index + 1}</legend>
          {q.options.map((o, i) => {
            const checked = selected.includes(o.id);
            return (
              <label
                key={o.id}
                className={cx(
                  "flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm",
                  checked ? "border-teal-600 bg-teal-50" : "border-slate-200 hover:bg-slate-50",
                )}
              >
                <input
                  type={q.type === "MULTI_CHOICE" ? "checkbox" : "radio"}
                  name={`q-${q.id}`}
                  className="mt-0.5 h-4 w-4 shrink-0"
                  checked={checked}
                  disabled={!live}
                  onChange={(e) => onChoose(o.id, e.target.checked)}
                  aria-label={`Option ${optionLetter(i)}${o.text ? `: ${o.text}` : o.imageAlt ? `: ${o.imageAlt}` : ""}`}
                />
                <span aria-hidden="true" className="font-bold text-slate-600">
                  {optionLetter(i)}
                </span>
                <span className="min-w-0 flex-1">
                  {o.imageUrl && <Picture src={o.imageUrl} alt={o.imageAlt} className="mb-1 max-h-56" />}
                  {o.text && <span className="block text-slate-800">{o.text}</span>}
                  {o.detail && <span className="block text-xs text-slate-600 italic">{o.detail}</span>}
                </span>
              </label>
            );
          })}
        </fieldset>
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
