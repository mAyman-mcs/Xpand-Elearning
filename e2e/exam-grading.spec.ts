import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { asUser, authFile, call, categoryId, createGroup, expect, studentSession, test, uid } from "./fixtures";

// Exam types and manual grading end to end (docs/EXAM_TYPES_PLAN.md): the admin picks "MCQ + essay"
// (auto scoring is not offered), a student answers an essay, a grader approves, and the score appears.

const PASSWORD = "Student-pass-2026";

async function noSeriousA11yProblems(page: Page, where: string) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  const blocking = results.violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => `${v.id}: ${v.help}`);
  expect(blocking, `accessibility problems on ${where}`).toEqual([]);
}

test.use({ storageState: authFile("admin") });

test("an essay exam: chosen type, essay answer, grading, approval", async ({
  page,
  browser,
  apiAs,
  playwright,
  baseURL,
}) => {
  test.setTimeout(120_000);
  const admin = await apiAs("admin");
  const code = `E2E-G${uid("")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(-10)}`;
  const title = `E2E Essay ${code}`;
  const exam = await call<{ id: string }>(admin, "post", "/catalog/exams", {
    code,
    title,
    categoryId: await categoryId(admin, "cloud"),
    durationMinutes: 30,
  });

  // ─── The admin chooses the type: with essays, only "Needs approval" is possible ───
  await page.goto(`/exams/${exam.id}`);
  const auto = page.getByRole("radio", { name: /Auto scored/ });
  await expect(auto).toBeChecked();
  await page.getByRole("radio", { name: /Multiple choice \+ essay/ }).check();
  await expect(auto).toBeDisabled();
  await expect(page.getByRole("radio", { name: /Needs approval/ })).toBeChecked();
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Exam saved")).toBeVisible();
  await expect(page.getByText("Needs approval", { exact: true })).toBeVisible();

  // Content (through the API: the question editor has its own spec), then publish and assign.
  await call(admin, "post", `/catalog/exams/${exam.id}/questions`, {
    type: "SINGLE_CHOICE",
    text: "Which port does HTTPS use?",
    options: [
      { text: "80", isCorrect: false },
      { text: "443", isCorrect: true },
    ],
  });
  await call(admin, "post", `/catalog/exams/${exam.id}/questions`, {
    type: "ESSAY",
    text: "Explain what TLS protects.",
    points: 5,
    guidance: "Confidentiality and integrity in transit.",
  });
  await call(admin, "patch", `/catalog/exams/${exam.id}`, {
    shuffleQuestions: false,
    shuffleOptions: false,
    requireFullscreen: false,
    status: "PUBLISHED",
  });
  const student = await studentSession(admin, playwright, baseURL ?? "", "Esra Essay");
  await student.api.dispose();
  const group = await createGroup(admin, "2026-07-01", [{ id: student.id }]);
  await call(admin, "post", "/assignments", {
    examId: exam.id,
    target: { groupId: group.id },
    schedule: { mode: "FIXED", opensAt: new Date(Date.now() - 3_600_000).toISOString(), closesAt: null },
  });

  // ─── The student answers both questions ───
  const s = await asUser(browser, "/student", student.username, PASSWORD);
  const card = s.page.getByRole("listitem").filter({ hasText: title });
  await card.getByRole("link", { name: "Start exam" }).click();
  await s.page.getByRole("checkbox", { name: /I have read the rules/ }).check();
  await s.page.getByRole("button", { name: "Start exam" }).click();

  await s.page.getByRole("radio", { name: "443" }).check();
  await expect(s.page.getByRole("status").filter({ hasText: "Saved" })).toBeVisible();
  await s.page.getByRole("button", { name: "Next" }).click();
  await expect(s.page.getByRole("heading", { name: "Explain what TLS protects." })).toBeVisible();
  const answer = s.page.getByRole("textbox", { name: "Your answer" });
  await answer.fill("TLS keeps traffic private and unchanged in transit.");
  await expect(s.page.getByText(/^51 \/ 10,000 characters/)).toBeVisible();
  await expect(s.page.getByRole("status").filter({ hasText: "Saved" })).toBeVisible();
  // Select all works in the essay box and is not recorded as a violation.
  await answer.press("Control+a");
  await expect(s.page.getByText("Violations: 0 / 3")).toBeVisible();

  await s.page.getByRole("button", { name: "Submit exam" }).click();
  await s.page
    .getByRole("dialog", { name: "Submit the exam?" })
    .getByRole("button", { name: "Submit", exact: true })
    .click();
  await expect(s.page.getByText(/Your score will be available after your answers are graded/)).toBeVisible();
  await s.page.getByRole("link", { name: "Back to my exams" }).click();
  await expect(card.getByText("Awaiting grading")).toBeVisible();

  // ─── A grader approves ───
  await page.goto(`/exams/${exam.id}/grading`);
  await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
  await noSeriousA11yProblems(page, "grading queue");
  await page.getByRole("link", { name: "Grade Esra Essay" }).click();

  await expect(page.getByText("TLS keeps traffic private and unchanged in transit.")).toBeVisible();
  await expect(page.getByText("Confidentiality and integrity in transit.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Approve" })).toBeDisabled();
  await noSeriousA11yProblems(page, "grade attempt");
  await page.getByLabel("Points (0–5)").fill("4");
  await page.getByLabel("Feedback (optional)").fill("Good, mention authentication too.");
  await expect(page.getByText(/Total: 5/)).toBeVisible();
  await page.getByRole("button", { name: "Approve" }).click();
  await expect(page.getByText("Approved: 5 / 6")).toBeVisible();
  await expect(page.getByRole("button", { name: "Reopen" })).toBeVisible();

  // The student's dashboard no longer waits for grading.
  await s.page.reload();
  await expect(card).toContainText("Submitted");
  await expect(card.getByText("Awaiting grading")).toHaveCount(0);
  await s.context.close();
});
