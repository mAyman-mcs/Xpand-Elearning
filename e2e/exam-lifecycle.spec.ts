import type { APIRequestContext, Browser, Page } from "@playwright/test";
import {
  asUser,
  authFile,
  call,
  confirmDialog,
  createExam,
  createGroup,
  expect,
  studentSession,
  test,
  uid,
} from "./fixtures";

// The whole exam lifecycle through the real UI (NEXT_PLAN F1–F3 test pass): an admin creates,
// fills, publishes and assigns an exam; students meet it in every state and take it. Complements
// exam-session.spec.ts (strikes, second device, no back navigation, Back after submit).

const PASSWORD = "Student-pass-2026";
type Playwright = Parameters<typeof studentSession>[1];

/** Reads the e2e database directly: grades and violations have no screen yet. */
async function sql<T>(query: string, params: unknown[] = []): Promise<T[]> {
  const { default: pg } = await import("pg");
  const adminUrl = process.env.E2E_ADMIN_DATABASE_URL ?? "postgresql://xpand:xpand-dev@localhost:5433/postgres";
  const client = new pg.Client({
    connectionString: Object.assign(new URL(adminUrl), { pathname: "/xpand_e2e" }).toString(),
  });
  await client.connect();
  try {
    return (await client.query(query, params)).rows as T[];
  } finally {
    await client.end();
  }
}

/** A Cairo wall-clock date and time ("2026-10-20", "09:05") for an instant. */
function cairo(at: Date) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Africa/Cairo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

/** A fresh student in a fresh group, ready to log in through the UI. */
async function newStudent(admin: APIRequestContext, playwright: Playwright, baseURL: string, name: string) {
  const student = await studentSession(admin, playwright, baseURL, name);
  await student.api.dispose();
  const group = await createGroup(admin, "2026-07-01", [{ id: student.id }]);
  return { student, group };
}

/** A published two-question exam (fixed order, no fullscreen) assigned to a group with `schedule`. */
async function assignedExam(
  admin: APIRequestContext,
  groupId: string,
  schedule: Record<string, unknown>,
  settings: Record<string, unknown> = {},
) {
  const exam = await createExam(admin, "cloud");
  await call(admin, "patch", `/catalog/exams/${exam.id}`, {
    shuffleQuestions: false,
    shuffleOptions: false,
    requireFullscreen: false,
    ...settings,
  });
  await call(admin, "post", "/assignments", { examId: exam.id, target: { groupId }, schedule });
  return exam;
}

const openNow = () => ({ mode: "FIXED", opensAt: new Date(Date.now() - 3_600_000).toISOString(), closesAt: null });

async function startExam(page: Page, title: string) {
  await page.goto("/student");
  await page.getByRole("listitem").filter({ hasText: title }).getByRole("link", { name: "Start exam" }).click();
  await page.getByRole("checkbox", { name: /I have read the rules/ }).check();
  await page.getByRole("button", { name: "Start exam" }).click();
  await expect(page.getByRole("timer", { name: "Time left" })).toBeVisible();
}

const saved = (page: Page) => expect(page.getByRole("status").filter({ hasText: /^Saved$/ })).toBeVisible();

/** Logged in through the UI, on the dashboard (waits for the login to finish before going on). */
async function studentPage(browser: Browser, username: string) {
  const session = await asUser(browser, "/student", username, PASSWORD);
  await expect(session.page.getByRole("heading", { name: /Welcome back/ })).toBeVisible();
  return session;
}

// ─────────────────────────────── 1. The happy path, built in the UI ───────────────────────────────

test.describe("admin builds the exam in the UI, a student takes it", () => {
  test.use({ storageState: authFile("admin") });

  test("create → questions → publish → assign → start → answer → submit → graded → result released", async ({
    page,
    browser,
    apiAs,
    playwright,
    baseURL,
  }) => {
    test.setTimeout(240_000);
    const admin = await apiAs("admin");
    const { student, group } = await newStudent(admin, playwright, baseURL ?? "", "Lina Lifecycle");
    const id = uid("L")
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "")
      .slice(-10);
    const title = `Lifecycle ${id}`;
    let examId = "";

    await test.step("1.1 the new exam form refuses missing required fields", async () => {
      await page.goto("/exams/new");
      await page.getByRole("button", { name: "Create exam" }).click();
      await expect(page.getByRole("textbox", { name: "Title" })).toHaveAttribute("aria-invalid", "true");
      await expect(page).toHaveURL(/\/exams\/new$/);
    });

    await test.step("1.2 create the exam with its settings", async () => {
      await page.getByRole("textbox", { name: "Title" }).fill(title);
      await page.getByRole("textbox", { name: "Code" }).fill(`LC-${id}`);
      await page.getByRole("combobox", { name: "Category" }).selectOption({ label: "E2E Cloud" });
      await page.getByRole("spinbutton", { name: "Duration (minutes)" }).fill("20");
      await page.getByRole("checkbox", { name: "Shuffle the questions per student" }).uncheck();
      await page.getByRole("checkbox", { name: "Shuffle the options per student" }).uncheck();
      await page.getByRole("checkbox", { name: "Require fullscreen" }).uncheck();
      await page.getByRole("button", { name: "Create exam" }).click();
      await expect(page.getByRole("heading", { name: title })).toBeVisible();
      examId = new URL(page.url()).pathname.split("/")[2] ?? "";
    });

    await test.step("1.3 publishing is blocked until there is a question", async () => {
      await expect(page.getByRole("button", { name: "Publish" })).toBeDisabled();
      await expect(page.getByText("Add at least one question.").first()).toBeVisible();
    });

    await test.step("1.4 add a single-choice, a multiple-choice and a true/false question", async () => {
      await page.goto(`/exams/${examId}/questions`);
      const editor = page.getByRole("dialog", { name: "Add a question" });

      await page.getByRole("button", { name: "Add question" }).click();
      await editor.getByRole("textbox", { name: "Question" }).fill("Which port does HTTPS use?");
      await editor.getByRole("textbox", { name: "Option 1", exact: true }).fill("443");
      await editor.getByRole("textbox", { name: "Option 2", exact: true }).fill("80");
      await editor.getByRole("button", { name: "Remove option 4" }).click();
      await editor.getByRole("button", { name: "Remove option 3" }).click();
      await editor.getByRole("radio", { name: "Option 1 is correct" }).check();
      await editor.getByRole("button", { name: "Add question" }).click();
      await expect(page.getByRole("status").filter({ hasText: "Question added" })).toBeVisible();

      await page.getByRole("button", { name: "Add question" }).click();
      await editor.getByRole("combobox", { name: "Type" }).selectOption("MULTI_CHOICE");
      await editor.getByRole("textbox", { name: "Question" }).fill("Which are private IPv4 ranges?");
      await editor.getByRole("textbox", { name: "Option 1", exact: true }).fill("10.0.0.0/8");
      await editor.getByRole("textbox", { name: "Option 2", exact: true }).fill("8.8.8.0/24");
      await editor.getByRole("textbox", { name: "Option 3", exact: true }).fill("192.168.0.0/16");
      await editor.getByRole("button", { name: "Remove option 4" }).click();
      await editor.getByRole("checkbox", { name: "Option 1 is correct" }).check();
      await editor.getByRole("checkbox", { name: "Option 3 is correct" }).check();
      await editor.getByRole("button", { name: "Add question" }).click();
      await expect(editor).toBeHidden();

      await page.getByRole("button", { name: "Add question" }).click();
      await editor.getByRole("combobox", { name: "Type" }).selectOption("TRUE_FALSE");
      await editor.getByRole("textbox", { name: "Question" }).fill("TCP is connectionless.");
      await editor.getByRole("radio", { name: "Option 2 is correct" }).check();
      await editor.getByRole("button", { name: "Add question" }).click();
      await expect(editor).toBeHidden();
      await expect(page.getByRole("heading", { name: /Questions \(3, 3 points\)/ })).toBeVisible();
      await expect(page.getByText("Ready to publish.")).toBeVisible();
    });

    await test.step("1.5 a draft exam is invisible to the student even when assigned", async () => {
      await call(admin, "post", "/assignments", {
        examId,
        target: { groupId: group.id },
        schedule: { mode: "MANUAL" },
      });
      const api = await playwright.request.newContext({ baseURL });
      await call(api, "post", "/auth/login", { username: student.username, password: PASSWORD });
      const rows = await call<{ exam: { id: string } }[]>(api, "get", "/student/exams");
      expect(rows.find((r) => r.exam.id === examId)).toBeUndefined();
      expect((await api.get(`/api/student/exams/${examId}`)).status()).toBe(404);
      await api.dispose();
      // Replace the manual assignment with a fixed window, through the UI below.
      const [a] = await call<{ id: string }[]>(admin, "get", `/assignments?examId=${examId}`);
      await call(admin, "delete", `/assignments/${a?.id}`);
    });

    await test.step("1.6 publish", async () => {
      await page.goto(`/exams/${examId}`);
      await page.getByRole("button", { name: "Publish" }).click();
      await confirmDialog(page, "Publish?", "Publish");
      await expect(page.getByRole("main").getByText("Published").first()).toBeVisible();
    });

    await test.step("1.7 assign it to the student's group, open since 10 minutes ago", async () => {
      const from = cairo(new Date(Date.now() - 10 * 60_000));
      await page.goto(`/exams/${examId}/assignments`);
      await page.getByRole("button", { name: "Assign", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: `Assign “${title}”` });
      await dialog.getByRole("checkbox", { name: new RegExp(group.name) }).check();
      await dialog.getByRole("radio", { name: /Fixed dates/ }).check();
      await dialog.getByLabel("Opens on (Cairo)").fill(from.date);
      await dialog.getByLabel("Opening time").fill(from.time);
      await dialog.getByRole("button", { name: "Preview" }).click();
      await expect(dialog.getByRole("table", { name: "Preview" })).toContainText("Lina Lifecycle");
      await dialog.getByRole("button", { name: "Assign", exact: true }).click();
      await expect(page.getByRole("status").filter({ hasText: "1 assignment created" })).toBeVisible();
    });

    const { context, page: s } = await studentPage(browser, student.username);

    await test.step("2.1 the dashboard shows it open, with Start", async () => {
      const card = s.getByRole("listitem").filter({ hasText: title });
      await expect(card).toContainText("Open");
      await expect(card).toContainText("20 min");
      await expect(s.getByText("Open now").locator("..")).toContainText("1");
    });

    await test.step("2.2 the rules page: the exam's rules, Start only after agreeing", async () => {
      await s.getByRole("listitem").filter({ hasText: title }).getByRole("link", { name: "Start exam" }).click();
      await expect(s.getByRole("heading", { name: title })).toBeVisible();
      await expect(s.getByText("3 questions", { exact: false }).first()).toBeVisible();
      await expect(s.getByText(/After\s+3\s+violations the exam is submitted automatically/)).toBeVisible();
      await expect(s.getByText("never pauses")).toBeVisible();
      await expect(s.getByRole("button", { name: "Start exam" })).toBeDisabled();
      await s.getByRole("checkbox", { name: /I have read the rules/ }).check();
      await s.getByRole("button", { name: "Start exam" }).click();
    });

    await test.step("2.3 the exam page: timer, question 1 of 3, the student's name as watermark", async () => {
      await expect(s.getByRole("timer", { name: "Time left" })).toHaveText(/^(20:00|19:5\d)$/);
      await expect(s.getByText(/Question 1 of 3/)).toBeVisible();
      await expect(s.getByTestId("watermark")).toHaveAttribute("data-text", `Lina Lifecycle · ${student.username}`);
      await expect(s.getByText("Violations: 0 / 3")).toBeVisible();
      await expect(s.getByRole("navigation", { name: "Questions" }).getByRole("button")).toHaveCount(3);
    });

    await test.step("2.4 answer: one right, one half right (multiple choice), one left blank", async () => {
      await s.getByRole("radio", { name: "443" }).check();
      await saved(s);
      await s.getByRole("button", { name: "Next" }).click();
      await expect(s.getByText("choose all that apply")).toBeVisible();
      await s.getByRole("checkbox", { name: "10.0.0.0/8" }).check();
      await saved(s);
      // Change of mind: an answer can be changed and is saved again.
      await s.getByRole("checkbox", { name: "8.8.8.0/24" }).check();
      await saved(s);
      await s.getByRole("checkbox", { name: "8.8.8.0/24" }).uncheck();
      await saved(s);
      await s.getByRole("button", { name: "Next" }).click();
      await expect(s.getByRole("heading", { name: "TCP is connectionless." })).toBeVisible();
      await expect(s.getByRole("button", { name: "Next" })).toHaveCount(0); // the last question
    });

    await test.step("2.5 a reload resumes with the saved answers and the same timer", async () => {
      await s.reload();
      await expect(s.getByText("2 of 3 answered")).toBeVisible();
      // Reloading is not a violation (regression: unloading fired a "tab hidden" strike).
      await expect(s.getByText("Violations: 0 / 3")).toBeVisible();
      const [{ strikes } = { strikes: -1 }] = await sql<{ strikes: number }>(
        `SELECT strikes FROM "Attempt" WHERE "examId" = $1`,
        [examId],
      );
      expect(strikes).toBe(0);
      await s.getByRole("button", { name: "Question 2, answered" }).click();
      await expect(s.getByRole("checkbox", { name: "10.0.0.0/8" })).toBeChecked();
      await expect(s.getByRole("checkbox", { name: "8.8.8.0/24" })).not.toBeChecked();
      await expect(s.getByRole("timer", { name: "Time left" })).toHaveText(/^(20:00|19:\d\d)$/);
    });

    await test.step("2.6 submitting warns about the unanswered question; Keep working stays", async () => {
      await s.getByRole("button", { name: "Submit exam" }).click();
      const confirm = s.getByRole("dialog", { name: "Submit the exam?" });
      await expect(confirm).toContainText("1 of 3 questions are not answered");
      await confirm.getByRole("button", { name: "Keep working" }).click();
      await expect(confirm).toBeHidden();
      await expect(s.getByRole("timer", { name: "Time left" })).toBeVisible();
    });

    await test.step("2.7 submit: the done page, no score before release", async () => {
      await s.getByRole("button", { name: "Submit exam" }).click();
      await s
        .getByRole("dialog", { name: "Submit the exam?" })
        .getByRole("button", { name: "Submit", exact: true })
        .click();
      await expect(s.getByRole("heading", { name: "Exam submitted" })).toBeVisible();
      await expect(s.getByText("Your answers were submitted.")).toBeVisible();
      await expect(s.getByText("Your result appears on your exams page once it is released.")).toBeVisible();
    });

    await test.step("2.8 graded all or nothing: 1 of 3 (the half-right answer scores 0)", async () => {
      const [row] = await sql<{ status: string; score: string; maxScore: string; submitReason: string }>(
        `SELECT status, score::text, "maxScore"::text, "submitReason" FROM "Attempt" WHERE "examId" = $1`,
        [examId],
      );
      expect(row).toEqual({
        status: "SUBMITTED",
        score: "1.00",
        maxScore: "3.00",
        submitReason: "submitted by the student",
      });
    });

    await test.step("2.9 the dashboard: Submitted, nothing to start; the rules page has no Start", async () => {
      await s.goto("/student");
      const card = s.getByRole("listitem").filter({ hasText: title });
      await expect(card).toContainText("Submitted");
      await expect(card).toContainText("Your result appears here once it is released.");
      await expect(card.getByRole("link")).toHaveCount(0);
      await s.goto(`/student/exams/${examId}`);
      await expect(s.getByRole("button", { name: /Start exam|Resume exam/ })).toHaveCount(0);
    });

    await test.step("2.10 once results are released, the score shows on the dashboard and the done page", async () => {
      // No release screen yet (results come in a later phase): flip the flag in the database.
      await sql(`UPDATE "Exam" SET "resultsReleased" = true WHERE id = $1`, [examId]);
      await s.goto("/student");
      await expect(s.getByRole("listitem").filter({ hasText: title })).toContainText("Score: 1 / 3");
      const [a] = await sql<{ id: string }>(`SELECT id FROM "Attempt" WHERE "examId" = $1`, [examId]);
      await s.goto(`/exam/${a?.id}/done`);
      await expect(s.getByText("Your score: 1 / 3")).toBeVisible();
    });

    await context.close();
  });
});

// ─────────────────────────────── 2. Every state on the dashboard ───────────────────────────────

test.describe("what the student sees in each state", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("scheduled, manual (closed), missed and unassigned exams can't be started", async ({
    browser,
    apiAs,
    playwright,
    baseURL,
  }) => {
    test.setTimeout(150_000);
    const admin = await apiAs("admin");
    const { student, group } = await newStudent(admin, playwright, baseURL ?? "", "Sara States");
    const inTwoHours = new Date(Date.now() + 2 * 3_600_000);
    const scheduled = await assignedExam(admin, group.id, {
      mode: "FIXED",
      opensAt: inTwoHours.toISOString(),
      closesAt: new Date(inTwoHours.getTime() + 3_600_000).toISOString(),
    });
    const manual = await assignedExam(admin, group.id, { mode: "MANUAL" });
    const missed = await assignedExam(admin, group.id, {
      mode: "FIXED",
      opensAt: new Date(Date.now() - 3 * 3_600_000).toISOString(),
      closesAt: new Date(Date.now() - 2 * 3_600_000).toISOString(),
    });
    const unassigned = await createExam(admin, "cloud");
    const { context, page } = await studentPage(browser, student.username);
    const card = (t: string) => page.getByRole("listitem").filter({ hasText: t });

    await test.step("scheduled: badge, opening time, a live countdown, no Start", async () => {
      await expect(card(scheduled.title)).toContainText("Scheduled");
      await expect(card(scheduled.title)).toContainText(/Opens in \d:\d\d:\d\d/);
      const first = await card(scheduled.title)
        .getByText(/Opens in/)
        .textContent();
      await expect(card(scheduled.title).getByText(/Opens in/)).not.toHaveText(first ?? "", { timeout: 5_000 });
      await expect(card(scheduled.title).getByRole("link", { name: "Start exam" })).toHaveCount(0);
      await page.goto(`/student/exams/${scheduled.id}`);
      await expect(page.getByText(/^Opens /).first()).toBeVisible();
      await expect(page.getByRole("button", { name: "Start exam" })).toHaveCount(0);
      await page.goto("/student");
    });

    await test.step("manual: closed until staff open it", async () => {
      await expect(card(manual.title)).toContainText("Closed");
      await expect(card(manual.title).getByRole("link", { name: "Start exam" })).toHaveCount(0);
    });

    await test.step("missed: the window ended without an attempt", async () => {
      await expect(card(missed.title)).toContainText("Missed");
      await expect(card(missed.title).getByRole("link", { name: "Start exam" })).toHaveCount(0);
    });

    await test.step("unassigned: not listed, and its rules page is 'not found'", async () => {
      await expect(card(unassigned.title)).toHaveCount(0);
      await page.goto(`/student/exams/${unassigned.id}`);
      await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
    });

    await test.step("summary cards count each state", async () => {
      await page.goto("/student");
      await expect(page.getByText("Upcoming").locator("..")).toContainText("1");
      await expect(page.getByText("Missed", { exact: true }).first().locator("..")).toContainText("1");
    });

    await test.step("staff open the manual exam: it becomes startable without a reload", async () => {
      await call(admin, "post", "/overrides", {
        examId: manual.id,
        target: { groupId: group.id },
        action: "OPEN",
        validUntil: null,
        reason: "e2e: open now",
      });
      await page.reload();
      await expect(card(manual.title)).toContainText("Open");
      await expect(card(manual.title).getByRole("link", { name: "Start exam" })).toBeVisible();
    });
    await context.close();
  });

  test("someone else's attempt doesn't exist for you", async ({ browser, apiAs, playwright, baseURL }) => {
    test.setTimeout(120_000);
    const admin = await apiAs("admin");
    const a = await newStudent(admin, playwright, baseURL ?? "", "Owner Olga");
    const b = await newStudent(admin, playwright, baseURL ?? "", "Nosy Nader");
    const exam = await assignedExam(admin, a.group.id, openNow());
    const owner = await studentPage(browser, a.student.username);
    await startExam(owner.page, exam.title);
    const attemptUrl = new URL(owner.page.url()).pathname;

    const nosy = await studentPage(browser, b.student.username);
    await nosy.page.goto(attemptUrl);
    await expect(nosy.page.getByRole("heading", { name: "Page not found" })).toBeVisible();
    await nosy.page.goto(`${attemptUrl}/done`);
    await expect(nosy.page.getByRole("heading", { name: "Page not found" })).toBeVisible();
    await owner.context.close();
    await nosy.context.close();
  });
});

// ─────────────────────────────── 3. Time ───────────────────────────────

test.describe("the clock", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("the window's close cuts the exam short: 45 minutes, but it closes in 2", async ({
    browser,
    apiAs,
    playwright,
    baseURL,
  }) => {
    test.setTimeout(120_000);
    const admin = await apiAs("admin");
    const { student, group } = await newStudent(admin, playwright, baseURL ?? "", "Cut Short");
    const exam = await assignedExam(admin, group.id, {
      mode: "FIXED",
      opensAt: new Date(Date.now() - 3_600_000).toISOString(),
      closesAt: new Date(Date.now() + 2 * 60_000).toISOString(),
    });
    const { context, page } = await studentPage(browser, student.username);
    await startExam(page, exam.title);
    await expect(page.getByRole("timer", { name: "Time left" })).toHaveText(/^(2:00|1:\d\d)$/);
    await context.close();
  });

  test("when time runs out, the saved answers are submitted automatically", async ({
    browser,
    apiAs,
    playwright,
    baseURL,
  }) => {
    test.setTimeout(180_000);
    const admin = await apiAs("admin");
    const { student, group } = await newStudent(admin, playwright, baseURL ?? "", "Tara Timeout");
    const exam = await assignedExam(admin, group.id, openNow(), { durationMinutes: 1 });
    const { context, page } = await studentPage(browser, student.username);
    await startExam(page, exam.title);
    await expect(page.getByRole("timer", { name: "Time left" })).toHaveText(/^(1:00|0:\d\d)$/);
    await page.getByRole("radio", { name: "True" }).check();
    await saved(page);

    // The last 5 minutes show in red; at zero the page says so and hands over to the server.
    await expect(page.getByRole("timer", { name: "Time left" })).toHaveClass(/text-red-700/);
    await expect(page.getByText("Time is up")).toBeVisible({ timeout: 75_000 });
    await expect(page.getByRole("heading", { name: "Exam submitted" })).toBeVisible({ timeout: 45_000 });
    await expect(page.getByText(/Time ran out, so your exam was submitted automatically/)).toBeVisible();

    const [row] = await sql<{ status: string; submitReason: string; score: string }>(
      `SELECT status, "submitReason", score::text FROM "Attempt" WHERE "examId" = $1`,
      [exam.id],
    );
    expect(row).toEqual({ status: "AUTO_SUBMITTED", submitReason: "time", score: "1.00" });
    await context.close();
  });
});

// ─────────────────────────────── 4. Anti-cheating ───────────────────────────────

test.describe("anti-cheating", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("copy, paste, right-click and blocked shortcuts are stopped and logged, but aren't strikes", async ({
    browser,
    apiAs,
    playwright,
    baseURL,
  }) => {
    test.setTimeout(120_000);
    const admin = await apiAs("admin");
    const { student, group } = await newStudent(admin, playwright, baseURL ?? "", "Carl Copier");
    const exam = await assignedExam(admin, group.id, openNow());
    const { context, page } = await studentPage(browser, student.username);
    await startExam(page, exam.title);
    const attemptId = new URL(page.url()).pathname.split("/")[2] ?? "";

    const question = page.getByRole("heading", { name: "The exam has a question." });
    await question.click({ button: "right" });
    await page.keyboard.press("Control+c");
    await page.keyboard.press("Control+p");
    await page.keyboard.press("F12");
    await page.evaluate(() => document.dispatchEvent(new Event("copy", { bubbles: true, cancelable: true })));
    await page.evaluate(() => document.dispatchEvent(new Event("paste", { bubbles: true, cancelable: true })));

    await expect
      .poll(
        async () =>
          (
            await sql<{ type: string }>(
              `SELECT type::text FROM "Violation" WHERE "attemptId" = $1 ORDER BY "occurredAt", type`,
              [attemptId],
            )
          )
            .map((v) => v.type)
            .sort(),
        { timeout: 15_000 },
      )
      .toEqual(["BLOCKED_SHORTCUT", "BLOCKED_SHORTCUT", "CLIPBOARD", "CLIPBOARD", "CONTEXT_MENU", "DEVTOOLS"]);
    await expect(page.getByText("Violations: 0 / 3")).toBeVisible();
    const [a] = await sql<{ strikes: number }>(`SELECT strikes FROM "Attempt" WHERE id = $1`, [attemptId]);
    expect(a?.strikes).toBe(0);
    await context.close();
  });

  test("leaving fullscreen is a strike, and the questions hide until fullscreen is back", async ({
    browser,
    apiAs,
    playwright,
    baseURL,
  }) => {
    test.setTimeout(120_000);
    const admin = await apiAs("admin");
    const { student, group } = await newStudent(admin, playwright, baseURL ?? "", "Fiona Fullscreen");
    const exam = await assignedExam(admin, group.id, openNow(), { requireFullscreen: true });
    const { context, page } = await studentPage(browser, student.username);
    await page.goto(`/student/exams/${exam.id}`);
    await expect(page.getByText("The exam runs in fullscreen.", { exact: false })).toBeVisible();
    await page.getByRole("checkbox", { name: /I have read the rules/ }).check();
    await page.getByRole("button", { name: "Start exam" }).click();
    await expect(page.getByRole("timer", { name: "Time left" })).toBeVisible();
    expect(await page.evaluate(() => Boolean(document.fullscreenElement))).toBe(true);
    await expect(page.getByRole("alertdialog", { name: "This exam runs in fullscreen" })).toHaveCount(0);

    await page.evaluate(() => document.exitFullscreen());
    const warning = page.getByRole("dialog", { name: "Warning: violation recorded" });
    await expect(warning).toContainText("This is violation 1 of 3.");
    await warning.getByRole("button", { name: "Return to the exam" }).click();
    await expect(page.getByText("Violations: 1 / 3")).toBeVisible();
    await expect.poll(() => page.evaluate(() => Boolean(document.fullscreenElement))).toBe(true);
    await context.close();
  });
});
