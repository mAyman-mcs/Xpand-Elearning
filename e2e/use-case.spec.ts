import AxeBuilder from "@axe-core/playwright";
import type { APIRequestContext, Page } from "@playwright/test";
import { png } from "../server/src/test/images";
import { asUser, authFile, call, categoryId, createGroup, expect, studentSession, test, uid } from "./fixtures";

// Use-case exams end to end (docs/CASE_QUESTIONS_PLAN.md): a trainer adds a case, its picture
// options and written follow-ups; a student on a phone answers the whole case on one screen; a
// grader sees it grouped with the explanations and approves.

const PASSWORD = "Student-pass-2026";

async function noSeriousA11yProblems(page: Page, where: string) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  const blocking = results.violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => `${v.id}: ${v.help}`);
  expect(blocking, `accessibility problems on ${where}`).toEqual([]);
}

async function uploadPicture(api: APIRequestContext, examId: string, width: number) {
  const res = await api.post(`/api/uploads?examId=${examId}`, {
    data: png(width, 40),
    headers: { "Content-Type": "image/png" },
  });
  expect(res.status()).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

test.use({ storageState: authFile("admin") });

test("a use case: case editor, picture options, one screen per case, grading", async ({
  page,
  browser,
  apiAs,
  playwright,
  baseURL,
}) => {
  test.setTimeout(150_000);
  const admin = await apiAs("admin");
  const code = `E2E-U${uid("")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(-10)}`;
  const title = `E2E Use case ${code}`;
  const exam = await call<{ id: string }>(admin, "post", "/catalog/exams", {
    code,
    title,
    categoryId: await categoryId(admin, "cloud"),
    durationMinutes: 30,
    type: "MCQ_ESSAY",
    intro: "The story so far: TechBridge is moving to Linux.",
    shuffleQuestions: false,
    requireFullscreen: false,
  });

  // ─── The trainer adds a case on the questions page ───
  await page.goto(`/exams/${exam.id}/questions`);
  await page.getByRole("button", { name: "Add case" }).click();
  const caseDialog = page.getByRole("dialog", { name: "Add a case" });
  await caseDialog.getByRole("textbox", { name: "Title", exact: true }).fill("Boot sequence");
  await caseDialog.getByRole("combobox", { name: "Label (optional)" }).fill("design");
  await caseDialog
    .getByRole("textbox", { name: "Situation", exact: true })
    .fill("A junior asks what happens before the login screen.");
  await caseDialog.getByRole("textbox", { name: "Hint (optional)" }).fill("Firmware first.");
  await caseDialog.getByRole("button", { name: "Add case" }).click();
  await expect(page.getByText("Case added: now add its questions")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Boot sequence" })).toBeVisible();
  await expect(page.getByText("Case “Boot sequence” has no questions")).toBeVisible();

  // Its questions (the picture MCQ through the API; the follow-ups through the editor).
  const list = await call<{ cases: { id: string }[] }>(admin, "get", `/catalog/exams/${exam.id}/questions`);
  const caseId = list.cases[0]!.id;
  const [right, wrong] = [await uploadPicture(admin, exam.id, 60), await uploadPicture(admin, exam.id, 61)];
  await call(admin, "post", `/catalog/exams/${exam.id}/questions`, {
    type: "SINGLE_CHOICE",
    caseId,
    points: 2,
    text: "Which sequence is correct?",
    options: [
      {
        imageId: right,
        imageAlt: "Power, firmware, bootloader, kernel, login",
        isCorrect: true,
        explanation: "Firmware runs first",
      },
      { imageId: wrong, imageAlt: "Power, bootloader, firmware, kernel, login", isCorrect: false },
    ],
  });
  await page.reload();
  await page.getByRole("button", { name: "Add written follow-up" }).click();
  const qDialog = page.getByRole("dialog", { name: "Add a question to “Boot sequence”" });
  await qDialog
    .getByRole("textbox", { name: "Question", exact: true })
    .fill("Name the feature that only runs signed bootloaders.");
  await qDialog.getByLabel("Answer box").selectOption("SHORT");
  await qDialog.getByLabel("Model answer / guidance for graders (optional)").fill("Secure Boot");
  await qDialog.getByRole("button", { name: "Add question" }).click();
  await expect(page.getByText("Question added")).toBeVisible();
  await expect(page.getByText("Ready to publish.")).toBeVisible();
  await expect(page.getByText("Q1b")).toBeVisible();
  await noSeriousA11yProblems(page, "questions page with a case");

  await call(admin, "patch", `/catalog/exams/${exam.id}`, { status: "PUBLISHED" });
  const student = await studentSession(admin, playwright, baseURL ?? "", "Una Usecase");
  await student.api.dispose();
  const group = await createGroup(admin, "2026-07-01", [{ id: student.id }]);
  await call(admin, "post", "/assignments", {
    examId: exam.id,
    target: { groupId: group.id },
    schedule: { mode: "FIXED", opensAt: new Date(Date.now() - 3_600_000).toISOString(), closesAt: null },
  });

  // ─── The student, on a phone, answers the whole case on one screen ───
  const s = await asUser(browser, "/student", student.username, PASSWORD);
  await s.page.setViewportSize({ width: 390, height: 844 });
  const card = s.page.getByRole("listitem").filter({ hasText: title });
  await card.getByRole("link", { name: "Start exam" }).click();
  await expect(s.page.getByText("The story so far: TechBridge is moving to Linux.")).toBeVisible();
  await s.page.getByRole("checkbox", { name: /I have read the rules/ }).check();
  await s.page.getByRole("button", { name: "Start exam" }).click();

  await expect(s.page.getByRole("heading", { name: "Boot sequence" })).toBeVisible();
  await expect(s.page.getByText("DESIGN", { exact: true })).toBeVisible();
  await expect(s.page.getByText("Firmware first.")).toHaveCount(0); // hints are off
  // Picture options: zoom one (an in-page viewer), then choose by picture.
  await s.page.getByRole("button", { name: "Enlarge picture: Power, firmware, bootloader, kernel, login" }).click();
  await s.page.getByRole("dialog").getByRole("button", { name: "Close" }).click();
  await s.page.getByRole("radio", { name: "Option A: Power, firmware, bootloader, kernel, login" }).check();
  const short = s.page.getByRole("textbox", { name: /Your answer to question 2/ });
  await short.fill("Secure Boot");
  await expect(s.page.getByText(/^11 \/ 300 characters/)).toBeVisible();
  await expect(s.page.getByRole("status").filter({ hasText: "Saved" })).toHaveCount(2);
  const width = await s.page.evaluate(() => document.documentElement.scrollWidth);
  expect(width, "no sideways scrolling on a phone").toBeLessThanOrEqual(390);
  await noSeriousA11yProblems(s.page, "case screen");

  await s.page.getByRole("button", { name: "Submit exam" }).click();
  await s.page
    .getByRole("dialog", { name: "Submit the exam?" })
    .getByRole("button", { name: "Submit", exact: true })
    .click();
  await expect(s.page.getByText(/Your score will be available after your answers are graded/)).toBeVisible();
  await s.context.close();

  // ─── The grader sees the case, the explanation and the student's choice ───
  await page.goto(`/exams/${exam.id}/grading`);
  await page.getByRole("link", { name: "Grade Una Usecase" }).click();
  const theCase = page.getByRole("region", { name: "Case: Boot sequence" });
  await expect(theCase.getByText("Firmware first.")).toBeVisible(); // graders always see the hint
  await expect(theCase.getByText("Explanation: Firmware runs first")).toBeVisible();
  await expect(theCase.getByText("Student's choice")).toBeVisible();
  await expect(theCase.getByText("Secure Boot", { exact: true }).first()).toBeVisible();
  await noSeriousA11yProblems(page, "grading a case");
  await page.getByLabel("Points (0–1)").fill("1");
  await page.getByRole("button", { name: "Approve" }).click();
  await expect(page.getByText("Approved: 3 / 3")).toBeVisible();
});
