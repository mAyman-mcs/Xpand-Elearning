import {
  asUser,
  authFile,
  call,
  createExam,
  createGroup,
  expect,
  insertSubmittedAttempt,
  studentSession,
  test,
  uid,
} from "./fixtures";

// docs/FIXES_PLAN.md: category materials (fix 2), new assignments without a reload (fix 3) and the
// exam history on the user page (fix 4). Fix 1 (optional picture descriptions) is covered by the
// server and web tests.

const PASSWORD = "Student-pass-2026";
const openNow = () => ({ mode: "FIXED", opensAt: new Date(Date.now() - 3_600_000).toISOString(), closesAt: null });

test.use({ storageState: authFile("admin") });

test("category materials reach students with an exam in the category", async ({
  page,
  browser,
  apiAs,
  playwright,
  baseURL,
}) => {
  test.setTimeout(120_000);
  const admin = await apiAs("admin");
  const category = await call<{ id: string; name: string }>(admin, "post", "/catalog/categories", {
    name: uid("E2E Topic"),
  });
  const student = await studentSession(admin, playwright, baseURL ?? "", "Mona Materials");
  await student.api.dispose();
  const group = await createGroup(admin, "2026-07-01", [{ id: student.id }]);
  const exam = await createExam(admin, category);
  await call(admin, "post", "/assignments", { examId: exam.id, target: { groupId: group.id }, schedule: openNow() });

  // ─── Staff add a link on the category's section of the Materials page ───
  await page.goto("/admin/catalog");
  await page.getByRole("link", { name: `Materials of ${category.name}` }).click();
  await expect(page).toHaveURL(new RegExp(`/materials#category-${category.id}$`));
  const section = page.locator(`#category-${category.id}`);
  await section.getByRole("textbox", { name: "Title" }).fill("Topic reading list");
  await section.getByRole("textbox", { name: "Link" }).fill("https://docs.example.com/topic");
  await section.getByRole("button", { name: "Add" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Material added" })).toBeVisible();
  await expect(
    section
      .getByRole("table", { name: `Materials of ${category.name}` })
      .getByRole("link", { name: "Topic reading list" }),
  ).toHaveAttribute("href", "https://docs.example.com/topic");

  // ─── The student finds it under Materials ───
  const s = await asUser(browser, "/student", student.username, PASSWORD);
  await s.page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Materials" }).click();
  await expect(s.page.getByRole("heading", { name: category.name })).toBeVisible();
  await expect(s.page.getByRole("link", { name: "Topic reading list" })).toHaveAttribute(
    "href",
    "https://docs.example.com/topic",
  );
  await s.context.close();
});

test("an exam assigned while My exams is open appears without a reload", async ({
  browser,
  apiAs,
  playwright,
  baseURL,
}) => {
  test.setTimeout(120_000);
  const admin = await apiAs("admin");
  const student = await studentSession(admin, playwright, baseURL ?? "", "Rami Refresh");
  await student.api.dispose();
  const group = await createGroup(admin, "2026-07-01", [{ id: student.id }]);
  const exam = await createExam(admin, "cloud");

  const s = await asUser(browser, "/student", student.username, PASSWORD);
  await expect(s.page.getByText("No exams yet")).toBeVisible();
  await call(admin, "post", "/assignments", { examId: exam.id, target: { groupId: group.id }, schedule: openNow() });

  // Coming back to the tab asks the server again (as does the one-minute refresh).
  await s.page.evaluate(() => window.dispatchEvent(new Event("visibilitychange")));
  await expect(s.page.getByRole("listitem").filter({ hasText: exam.title })).toBeVisible();
  await s.context.close();
});

test("the users list counts exams taken; the user page lists them", async ({ page, apiAs, playwright, baseURL }) => {
  const admin = await apiAs("admin");
  const student = await studentSession(admin, playwright, baseURL ?? "", `Hana History ${uid("h")}`);
  await student.api.dispose();
  const group = await createGroup(admin, "2026-07-01", [{ id: student.id }]);
  const first = await createExam(admin, "cloud");
  const second = await createExam(admin, "cloud");
  for (const exam of [first, second]) {
    await call(admin, "post", "/assignments", { examId: exam.id, target: { groupId: group.id }, schedule: openNow() });
    await insertSubmittedAttempt(exam.id, student.id);
  }

  await page.goto(`/admin/users?q=${encodeURIComponent(student.username)}`);
  const row = page.getByRole("table", { name: "Users" }).getByRole("row", { name: new RegExp(student.username) });
  await expect(row).toContainText("2");
  await row.getByRole("link").click();

  const history = page.getByRole("table", { name: "Exam history" });
  await expect(history).toContainText(first.title);
  await expect(history).toContainText(second.title);
  await expect(history.getByRole("link", { name: `Preview ${first.title}` })).toBeVisible();
});
