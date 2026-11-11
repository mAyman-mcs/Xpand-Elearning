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
  const tabs = page.getByRole("navigation", { name: "Exam sections" });

  await page.goto(`/exams/${exam.id}`);
  await page.getByLabel("Introduction (optional)").fill("Not saved yet");
  await tabs.getByRole("link", { name: "Who and when" }).click();
  const leave = page.getByRole("dialog", { name: "Leave without saving?" });
  await leave.getByRole("button", { name: "Stay on this page" }).click();
  await expect(page.getByLabel("Introduction (optional)")).toHaveValue("Not saved yet");

  await tabs.getByRole("link", { name: "Who and when" }).click();
  await leave.getByRole("button", { name: "Discard changes" }).click();
  await expect(page).toHaveURL(new RegExp(`/exams/${exam.id}/access$`));
});

test("the old Assignments, Open / close and Availability addresses land on Who and when", async ({ page, apiAs }) => {
  const admin = await apiAs("admin");
  const exam = await createExam(admin, "cloud");
  const tabs = page.getByRole("navigation", { name: "Exam sections" });

  for (const old of ["assignments", "overrides", "availability"]) {
    await page.goto(`/exams/${exam.id}/${old}`);
    await expect(page).toHaveURL(new RegExp(`/exams/${exam.id}/access(#\\w+)?$`));
    await expect(tabs.getByRole("link", { name: "Who and when" })).toHaveAttribute("aria-current", "page");
  }
  // All three parts are on the one page.
  await expect(page.getByRole("heading", { name: "Assigned to" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Open or close now" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Who can take it, and why" })).toBeVisible();
});
