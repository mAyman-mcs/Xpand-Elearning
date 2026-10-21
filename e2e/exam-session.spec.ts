import type { APIRequestContext, Page } from "@playwright/test";
import { asUser, call, createExam, createGroup, expect, studentSession, test } from "./fixtures";

// The student side end to end (NEXT_PLAN F1–F3): dashboard → rules → exam → submitted, with the
// anti-cheating rules enforced by the server.

const PASSWORD = "Student-pass-2026";

/** A published exam with two questions in a fixed order, open now for a fresh student. */
async function openExamFor(
  admin: APIRequestContext,
  playwright: Parameters<typeof studentSession>[1],
  baseURL: string,
  settings: Record<string, unknown> = {},
) {
  const exam = await createExam(admin, "cloud");
  await call(admin, "post", `/catalog/exams/${exam.id}/questions`, {
    type: "SINGLE_CHOICE",
    text: "Which port does HTTPS use?",
    options: [
      { text: "80", isCorrect: false },
      { text: "443", isCorrect: true },
      { text: "22", isCorrect: false },
    ],
  });
  await call(admin, "patch", `/catalog/exams/${exam.id}`, {
    shuffleQuestions: false,
    shuffleOptions: false,
    requireFullscreen: false,
    ...settings,
  });
  const student = await studentSession(admin, playwright, baseURL, "Sami Session");
  const group = await createGroup(admin, "2026-07-01", [{ id: student.id }]);
  await call(admin, "post", "/assignments", {
    examId: exam.id,
    target: { groupId: group.id },
    schedule: { mode: "FIXED", opensAt: new Date(Date.now() - 3_600_000).toISOString(), closesAt: null },
  });
  await student.api.dispose();
  return { exam, student };
}

/** From the dashboard to the first question. */
async function startFromDashboard(page: Page, title: string) {
  const card = page.getByRole("listitem").filter({ hasText: title });
  await expect(card).toContainText("Open");
  await card.getByRole("link", { name: "Start exam" }).click();
  await expect(page.getByRole("heading", { name: "Before you start" })).toBeVisible();
  const start = page.getByRole("button", { name: "Start exam" });
  await expect(start).toBeDisabled();
  await page.getByRole("checkbox", { name: /I have read the rules/ }).check();
  await start.click();
  await expect(page).toHaveURL(/\/exam\/[0-9a-f-]+$/);
}

/** Pretends the student switched tabs (the browser can't really hide a page in a test). */
const hideTab = (page: Page) =>
  page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
  });

test.use({ storageState: { cookies: [], origins: [] } });

test("a student takes an exam: autosave, navigation, submit, and no way back in", async ({
  browser,
  apiAs,
  playwright,
  baseURL,
}) => {
  test.setTimeout(120_000);
  const admin = await apiAs("admin");
  const { exam, student } = await openExamFor(admin, playwright, baseURL ?? "");
  const { context, page } = await asUser(browser, "/student", student.username, PASSWORD);

  await expect(page.getByRole("heading", { name: /Welcome back/ })).toBeVisible();
  await startFromDashboard(page, exam.title);

  // The watermark and the server's timer.
  await expect(page.getByRole("timer", { name: "Time left" })).toHaveText(/^(45:00|44:5\d)$/);
  await expect(page.getByTestId("watermark")).toHaveAttribute("data-text", `Sami Session · ${student.username}`);

  // Question 1, saved on choosing.
  await expect(page.getByRole("heading", { name: "The exam has a question." })).toBeVisible();
  await page.getByRole("radio", { name: "True" }).check();
  await expect(page.getByRole("status").filter({ hasText: "Saved" })).toBeVisible();
  await page.getByRole("button", { name: "Next" }).click();

  // Question 2; then back to 1 with the navigator: the answer is still there.
  await expect(page.getByRole("heading", { name: "Which port does HTTPS use?" })).toBeVisible();
  await page.getByRole("radio", { name: "443" }).check();
  await expect(page.getByRole("status").filter({ hasText: "Saved" })).toBeVisible();
  await page.getByRole("button", { name: "Question 1, answered" }).click();
  await expect(page.getByRole("radio", { name: "True" })).toBeChecked();

  // A reload resumes the same attempt with the saved answers.
  await page.reload();
  await expect(page.getByRole("radio", { name: "True" })).toBeChecked();
  await expect(page.getByText("2 of 2 answered")).toBeVisible();

  // Copy and right-click are blocked and recorded, but don't count as violations.
  await page.getByRole("heading", { name: "The exam has a question." }).click({ button: "right" });
  await expect(page.getByText("Violations: 0 / 3")).toBeVisible();

  await page.getByRole("button", { name: "Submit exam" }).click();
  const confirm = page.getByRole("dialog", { name: "Submit the exam?" });
  await expect(confirm).toContainText("You can't change your answers after submitting.");
  await confirm.getByRole("button", { name: "Submit", exact: true }).click();

  await expect(page.getByRole("heading", { name: "Exam submitted" })).toBeVisible();
  await expect(page.getByText("Your result appears on your exams page once it is released.")).toBeVisible();
  const attemptUrl = page.url().replace(/\/done$/, "");

  // Back doesn't return to the questions; opening the exam URL again leads to the done page.
  await page.goBack();
  await expect(page.getByRole("radio")).toHaveCount(0);
  await page.goto(attemptUrl);
  await expect(page.getByRole("heading", { name: "Exam submitted" })).toBeVisible();

  // The dashboard shows it as submitted, with nothing to start.
  await page.goto("/student");
  const card = page.getByRole("listitem").filter({ hasText: exam.title });
  await expect(card).toContainText("Submitted");
  await expect(card.getByRole("link", { name: /Start exam|Resume exam/ })).toHaveCount(0);
  await context.close();
});

test("violations warn, and the limit submits the exam automatically", async ({
  browser,
  apiAs,
  playwright,
  baseURL,
}) => {
  test.setTimeout(120_000);
  const admin = await apiAs("admin");
  const { exam, student } = await openExamFor(admin, playwright, baseURL ?? "", { strikeLimit: 2 });
  const { context, page } = await asUser(browser, "/student", student.username, PASSWORD);
  await startFromDashboard(page, exam.title);
  await page.getByRole("radio", { name: "True" }).check();
  await expect(page.getByRole("status").filter({ hasText: "Saved" })).toBeVisible();

  await hideTab(page);
  const warning = page.getByRole("dialog", { name: "Warning: violation recorded" });
  await expect(warning).toContainText("This is violation 1 of 2.");
  await warning.getByRole("button", { name: "Return to the exam" }).click();
  await expect(page.getByText("Violations: 1 / 2")).toBeVisible();

  // Signals within 3 s are one action; the next one, later, reaches the limit.
  await page.waitForTimeout(3_200);
  await hideTab(page);
  await expect(page.getByRole("heading", { name: "Exam submitted" })).toBeVisible();
  await expect(page.getByText(/submitted automatically because the violation limit was reached/)).toBeVisible();
  await context.close();
});

test("an exam in progress can't be continued from a second browser", async ({
  browser,
  apiAs,
  playwright,
  baseURL,
}) => {
  test.setTimeout(120_000);
  const admin = await apiAs("admin");
  const { exam, student } = await openExamFor(admin, playwright, baseURL ?? "", { allowBackNavigation: false });
  const first = await asUser(browser, "/student", student.username, PASSWORD);
  await startFromDashboard(first.page, exam.title);
  const attemptUrl = first.page.url();

  // Without back navigation: no navigator, no Previous, and Next asks first.
  await expect(first.page.getByRole("navigation", { name: "Questions" })).toHaveCount(0);
  await first.page.getByRole("button", { name: "Next" }).click();
  await first.page
    .getByRole("dialog", { name: "Move to the next question?" })
    .getByRole("button", { name: "Next question" })
    .click();
  await expect(first.page.getByRole("heading", { name: "Which port does HTTPS use?" })).toBeVisible();
  await expect(first.page.getByRole("button", { name: "Previous" })).toHaveCount(0);

  const second = await asUser(browser, `/student/exams/${exam.id}`, student.username, PASSWORD);
  await second.page.getByRole("checkbox", { name: /I have read the rules/ }).check();
  await second.page.getByRole("button", { name: "Resume exam" }).click();
  await expect(second.page.getByRole("alert")).toContainText("in progress on another device or browser");
  await second.page.goto(attemptUrl);
  await expect(second.page.getByRole("heading", { name: "This exam is open on another device" })).toBeVisible();
  await expect(second.page.getByRole("radio")).toHaveCount(0);

  // The first browser carries on; the refused tries were recorded as a violation.
  await first.page.getByRole("radio", { name: "443" }).check();
  await expect(first.page.getByRole("status").filter({ hasText: "Saved" })).toBeVisible();
  await expect(first.page.getByText(/Violations: [1-9] \/ 3/)).toBeVisible({ timeout: 15_000 });
  await first.context.close();
  await second.context.close();
});
