import AxeBuilder from "@axe-core/playwright";
import type { APIRequestContext, Page } from "@playwright/test";
import { asUser, call, createExam, createGroup, expect, freshStaff, studentSession, test } from "./fixtures";

// The instructor dashboard (always there, grants or not), the submissions list with its preview,
// and "Give another attempt".

async function noSeriousA11yProblems(page: Page, where: string) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  const blocking = results.violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => `${v.id}: ${v.help}`);
  expect(blocking, `accessibility problems on ${where}`).toEqual([]);
}

/** The student takes the exam through the API and picks the wrong answer ("False"). */
async function takeExam(api: APIRequestContext, examId: string) {
  const attempt = await call<{
    attemptId: string;
    questions: { id: string; options: { id: string; text: string }[] }[];
  }>(api, "post", "/attempts", { examId });
  const q = attempt.questions[0]!;
  const wrong = q.options.find((o) => o.text === "False")!;
  await call(api, "put", `/attempts/${attempt.attemptId}/answers/${q.id}`, { selectedOptionIds: [wrong.id] });
  await call(api, "post", `/attempts/${attempt.attemptId}/submit`);
  return attempt.attemptId;
}

test("an instructor without any access still has their dashboard", async ({ browser, apiAs, playwright, baseURL }) => {
  const inst = await freshStaff(await apiAs("admin"), playwright, baseURL ?? "", "Nadia Nogrant");
  const { context, page } = await asUser(browser, "/", inst.username, inst.password);

  await expect(page).toHaveURL(/\/instructor$/);
  await expect(page.getByRole("heading", { name: "Welcome back, Nadia." })).toBeVisible();
  await expect(page.getByText("You don't have access to any exams yet")).toBeVisible();
  await expect(page.getByRole("link", { name: "Awaiting grading: 0" })).toBeVisible();
  await expect(page.getByText("No submissions yet")).toBeVisible();
  const nav = page.getByRole("navigation", { name: "Main" });
  await expect(nav.getByRole("link", { name: "Dashboard" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Exams" })).toHaveCount(0);

  await nav.getByRole("link", { name: "Submissions" }).click();
  await expect(page.getByRole("heading", { name: "Submissions" })).toBeVisible();
  await expect(page.getByText("No submissions yet")).toBeVisible();
  await context.close();
});

test("preview a submitted exam from the dashboard and give the student another attempt", async ({
  browser,
  apiAs,
  playwright,
  baseURL,
}) => {
  test.setTimeout(90_000);
  const admin = await apiAs("admin");
  const exam = await createExam(admin, "cloud");
  const student = await studentSession(admin, playwright, baseURL ?? "", "Rami Retake");
  const group = await createGroup(admin, "2026-07-01", [{ id: student.id }]);
  await call(admin, "post", "/assignments", {
    examId: exam.id,
    target: { groupId: group.id },
    schedule: { mode: "FIXED", opensAt: new Date(Date.now() - 3_600_000).toISOString(), closesAt: null },
  });
  const inst = await freshStaff(admin, playwright, baseURL ?? "", "Ivy Instructor", {
    permissions: ["RESULTS_VIEW", "EXAM_ASSIGN", "EXAM_SCHEDULE"],
    examIds: [exam.id],
    groupIds: [group.id],
  });
  await takeExam(student.api, exam.id);
  expect((await call<{ status: string }>(student.api, "get", `/student/exams/${exam.id}`)).status).toBe("SUBMITTED");

  // ─── The dashboard lists the submission; Preview shows every answer ───
  const { context, page } = await asUser(browser, "/", inst.username, inst.password);
  await expect(page).toHaveURL(/\/instructor$/);
  const latest = page.getByRole("table", { name: "Submitted exams" });
  await expect(latest.getByText("Rami Retake")).toBeVisible();
  await expect(latest.getByText("0 / 1")).toBeVisible();
  await noSeriousA11yProblems(page, "instructor dashboard");

  await latest.getByRole("link", { name: `Preview Rami Retake's ${exam.title}` }).click();
  await expect(page.getByRole("heading", { name: "Rami Retake" })).toBeVisible();
  await expect(page.getByText("The exam has a question.")).toBeVisible();
  await expect(page.getByText("Student's choice")).toBeVisible();
  await expect(page.getByText("1 of 1 questions")).toBeVisible();
  await noSeriousA11yProblems(page, "submission preview");

  // ─── Give another attempt, opened now ───
  await page.getByRole("button", { name: "Give another attempt" }).click();
  const dialog = page.getByRole("dialog", { name: "Give Rami Retake another attempt?" });
  await expect(dialog.getByRole("checkbox", { name: /Open the exam for them now/ })).toBeChecked();
  await dialog.getByRole("textbox", { name: /Reason/ }).fill("Connection dropped during the exam");
  await dialog.getByRole("button", { name: "Give another attempt" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: `Rami Retake can take ${exam.title} again now.` }),
  ).toBeVisible();
  // The exam is open for the student again: they take it a second time.
  expect((await call<{ status: string }>(student.api, "get", `/student/exams/${exam.id}`)).status).toBe("OPEN");
  const second = await takeExam(student.api, exam.id);

  // The list shows both attempts; only the new one can get yet another.
  await page.goto("/submissions");
  await expect(page.getByRole("link", { name: `Preview Rami Retake's ${exam.title}` })).toHaveCount(2);
  await expect(page.getByRole("button", { name: `Give Rami Retake another attempt at ${exam.title}` })).toHaveCount(1);
  await page.goto(`/submissions/${second}`);
  await expect(page.getByText("attempt 2", { exact: false })).toBeVisible();
  await context.close();
  await student.api.dispose();
});
