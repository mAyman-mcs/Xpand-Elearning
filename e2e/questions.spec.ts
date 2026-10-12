import {
  authFile,
  call,
  categoryId,
  confirmDialog,
  createUser,
  expect,
  insertSubmittedAttempt,
  test,
  uid,
} from "./fixtures";

test.use({ storageState: authFile("admin") });

async function draftExam(admin: Parameters<typeof call>[0]) {
  const code = `E2E-Q${uid("")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(-10)}`;
  const title = `E2E Questions ${code}`;
  const exam = await call<{ id: string }>(admin, "post", "/catalog/exams", {
    code,
    title,
    categoryId: await categoryId(admin, "networking"),
    durationMinutes: 30,
  });
  return { id: exam.id, title, code };
}

test("build an exam's questions, import more, reorder, delete, and publish", async ({ page, apiAs }) => {
  const exam = await draftExam(await apiAs("admin"));

  // Settings: publishing is blocked, and says why.
  await page.goto(`/exams/${exam.id}`);
  await expect(page.getByRole("button", { name: "Publish" })).toBeDisabled();
  await expect(page.getByText("Add at least one question.").first()).toBeVisible();
  await page.getByRole("link", { name: "Go to the questions" }).click();
  await expect(page.getByText("No questions yet")).toBeVisible();

  // A single-choice question; the save waits for a valid question.
  await page.getByRole("button", { name: "Add question" }).click();
  const editor = page.getByRole("dialog", { name: "Add a question" });
  await expect(editor.getByRole("button", { name: "Add question" })).toBeDisabled();
  await editor.getByRole("textbox", { name: "Question" }).fill("Which port does HTTPS use?");
  await editor.getByRole("textbox", { name: "Option 1", exact: true }).fill("443");
  await editor.getByRole("textbox", { name: "Option 2", exact: true }).fill("80");
  await editor.getByRole("button", { name: "Remove option 4" }).click();
  await editor.getByRole("button", { name: "Remove option 3" }).click();
  await expect(editor.getByRole("region", { name: "Student preview" })).toContainText("Which port does HTTPS use?");
  await editor.getByRole("button", { name: "Add question" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Question added" })).toBeVisible();

  // A true/false question: two fixed options.
  await page.getByRole("button", { name: "Add question" }).click();
  await editor.getByRole("combobox", { name: "Type" }).selectOption("TRUE_FALSE");
  await expect(editor.getByRole("textbox", { name: "Option 1", exact: true })).toHaveValue("True");
  await expect(editor.getByRole("button", { name: "Add option" })).toHaveCount(0);
  await editor.getByRole("textbox", { name: "Question" }).fill("A /24 network has 256 addresses.");
  await editor.getByRole("button", { name: "Add question" }).click();

  const questions = page.getByRole("list", { name: "Questions" });
  await expect(questions.locator(":scope > li")).toHaveCount(2);
  await expect(questions.locator(":scope > li").first()).toContainText("✓ 443");

  // Import: an invalid list is refused as a whole, with the reason per question.
  await page.getByRole("button", { name: "Import" }).click();
  const importer = page.getByRole("dialog", { name: "Import questions" });
  const multi = {
    type: "MULTI_CHOICE",
    text: "Which are private ranges?",
    options: [
      { text: "10.0.0.0/8", isCorrect: true },
      { text: "192.168.0.0/16", isCorrect: true },
      { text: "8.8.8.0/24", isCorrect: false },
    ],
  };
  const broken = { type: "SINGLE_CHOICE", text: "Broken", options: [{ text: "only one", isCorrect: true }] };
  await importer.getByRole("textbox", { name: "Questions (JSON)" }).fill(JSON.stringify([multi, broken]));
  await importer.getByRole("button", { name: "Check" }).click();
  await expect(importer.getByRole("alert")).toContainText("Question 2: Give between 2 and 10 options.");
  await importer.getByRole("textbox", { name: "Questions (JSON)" }).fill(JSON.stringify([multi]));
  await importer.getByRole("button", { name: "Check" }).click();
  await expect(importer.getByText("All questions are valid.")).toBeVisible();
  await importer.getByRole("button", { name: "Import 1 question" }).click();
  await expect(page.getByRole("status").filter({ hasText: "1 question imported" })).toBeVisible();
  await expect(page.getByRole("heading", { name: /Questions \(3, 3 points\)/ })).toBeVisible();

  // Reorder (persisted) and delete.
  await page.getByRole("button", { name: "Move question 3 up" }).click();
  await page.reload();
  // Direct children only: each question holds a nested list of options.
  await expect(questions.locator(":scope > li").nth(1)).toContainText("Which are private ranges?");
  await page.getByRole("button", { name: "Delete question 3" }).click();
  await confirmDialog(page, "Delete this question?", "Delete question");
  await expect(page.getByRole("heading", { name: /Questions \(2, 2 points\)/ })).toBeVisible();

  // Now it can be published.
  await expect(page.getByText("Ready to publish.")).toBeVisible();
  await page.getByRole("link", { name: "Settings" }).click();
  await page.getByRole("button", { name: "Publish" }).click();
  await confirmDialog(page, "Publish?", "Publish");
  await expect(page.getByRole("main").getByText("Published").first()).toBeVisible();
});

test("once students have taken it, only wording changes; duplicate to change more", async ({ page, apiAs }) => {
  const admin = await apiAs("admin");
  const exam = await draftExam(admin);
  await call(admin, "post", `/catalog/exams/${exam.id}/questions`, {
    type: "SINGLE_CHOICE",
    text: "Original wording?",
    options: [
      { text: "Yes", isCorrect: true },
      { text: "No", isCorrect: false },
    ],
  });
  const student = await createUser(admin, { fullName: "Took It" });
  await insertSubmittedAttempt(exam.id, student.id);

  await page.goto(`/exams/${exam.id}/questions`);
  await expect(page.getByRole("status").filter({ hasText: "Locked:" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add question" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Delete question 1" })).toHaveCount(0);

  await page.getByRole("button", { name: "Edit question 1" }).click();
  const editor = page.getByRole("dialog", { name: "Edit question" });
  await expect(editor.getByRole("combobox", { name: "Type" })).toBeDisabled();
  await expect(editor.getByRole("radio", { name: "Option 2 is correct" })).toBeDisabled();
  await editor.getByRole("textbox", { name: "Question" }).fill("Clearer wording?");
  await editor.getByRole("button", { name: "Save question" }).click();
  await expect(page.getByRole("list", { name: "Questions" })).toContainText("Clearer wording?");

  // Duplicate: a draft copy with the questions, fully editable.
  await page.getByRole("button", { name: "Duplicate exam" }).first().click();
  const dialog = page.getByRole("dialog", { name: "Duplicate exam" });
  const copyCode = `${exam.code}-V2`.slice(0, 31);
  await dialog.getByRole("textbox", { name: "Code of the copy" }).fill(copyCode);
  await dialog.getByRole("button", { name: "Create copy" }).click();
  await expect(page.getByRole("heading", { name: `${exam.title} (copy)` })).toBeVisible();
  await expect(page.getByRole("main").getByText("Draft").first()).toBeVisible();
  await expect(page.getByRole("list", { name: "Questions" })).toContainText("Clearer wording?");
  await expect(page.getByRole("button", { name: "Add question" })).toBeVisible();
});

test("training material: https links only, listed for students", async ({ page, apiAs }) => {
  const exam = await draftExam(await apiAs("admin"));
  await page.goto(`/exams/${exam.id}/materials`);
  await page.getByRole("textbox", { name: "Title" }).fill("Slides");
  await page.getByRole("textbox", { name: "Link" }).fill("http://insecure.example.com/slides");
  await expect(page.getByText("Use a full https:// link")).toBeVisible();
  await expect(page.getByRole("button", { name: "Add" })).toBeDisabled();
  await page.getByRole("textbox", { name: "Link" }).fill("https://docs.example.com/slides");
  await page.getByRole("button", { name: "Add" }).click();
  const table = page.getByRole("table", { name: "Materials" });
  await expect(table.getByRole("link", { name: "Slides" })).toHaveAttribute("href", "https://docs.example.com/slides");
  await table.getByRole("button", { name: "Remove Slides" }).click();
  await confirmDialog(page, "Remove “Slides”?", "Remove");
  await expect(page.getByText("No material yet")).toBeVisible();
});
