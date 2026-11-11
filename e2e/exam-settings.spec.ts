import { authFile, createExam, expect, test } from "./fixtures";

// The exam Settings tab saves every field it shows, and guards unsaved changes.

test.use({ storageState: authFile("admin") });

test("the introduction and case hints are saved", async ({ page, apiAs }) => {
  const admin = await apiAs("admin");
  const exam = await createExam(admin, "cloud");

  await page.goto(`/exams/${exam.id}`);
  await page.getByLabel("Introduction (optional)").fill("The story so far: a breach at the front desk.");
  await page.getByLabel(/Show case hints to students/).check();
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Exam saved")).toBeVisible();

  await page.reload();
  await expect(page.getByLabel("Introduction (optional)")).toHaveValue("The story so far: a breach at the front desk.");
  await expect(page.getByLabel(/Show case hints to students/)).toBeChecked();

  // Clearing the introduction saves "none".
  await page.getByLabel("Introduction (optional)").fill("");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Exam saved")).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Introduction (optional)")).toHaveValue("");
});

test("leaving the tab with unsaved settings asks first", async ({ page, apiAs }) => {
  const admin = await apiAs("admin");
  const exam = await createExam(admin, "cloud");

  await page.goto(`/exams/${exam.id}`);
  await page.getByLabel("Introduction (optional)").fill("Not saved yet");
  await page.getByRole("navigation", { name: "Exam sections" }).getByRole("link", { name: "Availability" }).click();
  const leave = page.getByRole("dialog", { name: "Leave without saving?" });
  await leave.getByRole("button", { name: "Stay on this page" }).click();
  await expect(page.getByLabel("Introduction (optional)")).toHaveValue("Not saved yet");

  await page.getByRole("navigation", { name: "Exam sections" }).getByRole("link", { name: "Availability" }).click();
  await leave.getByRole("button", { name: "Discard changes" }).click();
  await expect(page).toHaveURL(new RegExp(`/exams/${exam.id}/availability$`));
});
