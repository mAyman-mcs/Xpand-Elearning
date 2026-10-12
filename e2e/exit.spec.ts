import { readFile } from "node:fs/promises";
import { asUser, authFile, call, expect, login, studentExam, test, uid } from "./fixtures";
import { todayInCairo } from "../web/src/lib/time";

// The admin dashboard's exit test (docs/ADMIN_DASHBOARD_PLAN.md §7), automated: one story through
// the UI as the super admin, an instructor and a student, ending in the audit log.

test.use({ storageState: authFile("admin") });

const addDays = (ymd: string, days: number) => {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

test("exit test: import → grant → exam → instructor schedules → student sees it → open now → audit", async ({
  page,
  browser,
  playwright,
  baseURL,
}) => {
  test.setTimeout(180_000);
  const id = uid("x")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  const group = `Intake Test ${id}`;
  const category = `Cloud ${id}`;
  const examTitle = `Cloud Gates ${id}`;

  // 1. The dashboard shows its numbers.
  await page.goto("/admin");
  await expect(page.getByRole("link", { name: /^Students: \d+$/ })).toBeVisible();

  // 2. Import 10 students into a new group; one joins late.
  const rows = Array.from({ length: 10 }, (_, i) => {
    const late = i === 9;
    return `s${i}.${id},Student ${i} ${id},,,${group},2026-11-01,${late ? "2026-11-10" : ""}`;
  });
  await page.goto("/admin/users/import");
  await page.getByLabel("CSV file").setInputFiles({
    name: "intake.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(["username,fullName,email,mobile,group,groupIntakeDate,joinDate", ...rows].join("\r\n")),
  });
  await expect(page.getByText("10 students will be created.")).toBeVisible();
  await page.getByRole("button", { name: "Import 10 students" }).click();
  const credentials = page.getByRole("dialog", { name: "10 students imported" });
  const download = page.waitForEvent("download");
  await credentials.getByRole("button", { name: "Download credentials (CSV)" }).click();
  const csv = await readFile((await (await download).path()) ?? "", "utf8");
  const lateLine = csv.split(/\r?\n/).find((l) => l.startsWith(`s9.${id},`)) ?? "";
  const latePassword = lateLine.split(",").at(-1) ?? "";
  expect(latePassword.length).toBeGreaterThan(8);
  await credentials.getByRole("button", { name: "I have saved them" }).click();

  // 3. The category and an exam with 5 questions (imported), published.
  await page.goto("/admin/catalog");
  await page.getByRole("textbox", { name: "New category" }).fill(category);
  await page.getByRole("button", { name: "Add" }).first().click();
  await expect(page.getByRole("table", { name: "Categories" })).toContainText(category);

  await page.goto("/exams/new");
  await page.getByRole("textbox", { name: "Title" }).fill(examTitle);
  await page.getByRole("textbox", { name: "Code" }).fill(`CG-${id}`.slice(0, 31));
  await page.getByRole("combobox", { name: "Category" }).selectOption({ label: category });
  await page.getByRole("button", { name: "Create exam" }).click();
  await expect(page.getByRole("heading", { name: examTitle })).toBeVisible();
  const examIdValue = new URL(page.url()).pathname.split("/")[2] ?? "";

  await page.getByRole("link", { name: "Questions", exact: true }).click();
  await page.getByRole("button", { name: "Import" }).click();
  const five = Array.from({ length: 5 }, (_, i) => ({
    type: "TRUE_FALSE",
    text: `Cloud statement ${i + 1}`,
    options: [
      { text: "True", isCorrect: i % 2 === 0 },
      { text: "False", isCorrect: i % 2 === 1 },
    ],
  }));
  const importer = page.getByRole("dialog", { name: "Import questions" });
  await importer.getByRole("textbox", { name: "Questions (JSON)" }).fill(JSON.stringify(five));
  await importer.getByRole("button", { name: "Check" }).click();
  await importer.getByRole("button", { name: "Import 5 questions" }).click();
  await expect(page.getByRole("heading", { name: /Questions \(5, 5 points\)/ })).toBeVisible();
  await page.getByRole("link", { name: "Settings" }).click();
  await page.getByRole("button", { name: "Publish" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Publish" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Exam is now published" })).toBeVisible();

  // 4. An instructor with assign + schedule on that category × the new group, for 7 days.
  const instructorUsername = `inst.${id}`;
  await page.goto("/admin/users/new");
  await page.getByRole("textbox", { name: "Username" }).fill(instructorUsername);
  await page.getByRole("textbox", { name: "Full name" }).fill(`Instructor ${id}`);
  await page.getByRole("combobox", { name: "Role" }).selectOption("INSTRUCTOR");
  await page.getByRole("button", { name: "Create user" }).click();
  const created = page.getByRole("dialog", { name: "User created" });
  const instructorTemp = (await created.getByTestId("secret-value").nth(1).textContent()) ?? "";
  await created.getByRole("button", { name: "I have saved it" }).click();

  await page.goto("/admin/instructors");
  await page.getByRole("link", { name: new RegExp(`Instructor ${id}`) }).click();
  await page.getByRole("button", { name: "Grant access" }).click();
  const editor = page.getByRole("dialog", { name: `New access for Instructor ${id}` });
  await editor.getByRole("checkbox", { name: "Assign exams" }).check();
  await editor.getByRole("checkbox", { name: "Schedule and open/close exams" }).check();
  await editor.getByRole("checkbox", { name: category, exact: true }).check();
  await editor.getByRole("checkbox", { name: group }).check();
  await editor.getByLabel("Expires after (Cairo date, optional)").fill(addDays(todayInCairo(), 7));
  await editor.getByRole("button", { name: "Grant access" }).click();
  await expect(page.getByRole("list", { name: "Grants" })).toContainText(
    `exams in ${category}, for students in ${group}`,
  );

  // 5. As the instructor: only this exam and this group; schedule relative to the join date.
  const { context: instContext, page: inst } = await asUser(browser, "/exams", instructorUsername, instructorTemp);
  await inst.getByRole("textbox", { name: "Current (temporary) password" }).fill(instructorTemp);
  await inst.getByRole("textbox", { name: "New password", exact: true }).fill("Instructor-exit-2026");
  await inst.getByRole("textbox", { name: "Confirm new password" }).fill("Instructor-exit-2026");
  await inst.getByRole("button", { name: "Save password" }).click();
  const exams = inst.getByRole("table", { name: "Exams" });
  await expect(exams.getByRole("row")).toHaveCount(2);
  await expect(exams).toContainText(examTitle);
  await inst.goto("/students");
  await expect(inst.getByRole("table", { name: "Students" }).getByRole("row")).toHaveCount(11);

  await inst.goto(`/exams/${examIdValue}/assignments`);
  await inst.getByRole("button", { name: "Assign", exact: true }).click();
  const assign = inst.getByRole("dialog");
  await expect(assign.getByRole("group", { name: "Who" }).getByRole("checkbox")).toHaveCount(1);
  await assign.getByRole("checkbox", { name: new RegExp(group) }).check();
  await assign.getByRole("radio", { name: /Relative to join date/ }).check();
  await assign.getByRole("spinbutton", { name: "Days after joining" }).fill("14");
  await assign.getByLabel("At (Cairo time)").fill("10:00");
  await assign.getByRole("spinbutton", { name: "Open for (hours)" }).fill("2");
  await assign.getByRole("button", { name: "Preview" }).click();
  const preview = assign.getByRole("table", { name: "Preview" });
  await expect(preview.getByRole("row")).toHaveCount(11);
  await expect(preview.getByRole("row", { name: new RegExp(`Student 0 ${id}`) })).toContainText(
    "15 Nov 2026, 10:00 Cairo",
  );
  await expect(preview.getByRole("row", { name: new RegExp(`Student 9 ${id}`) })).toContainText(
    "24 Nov 2026, 10:00 Cairo",
  );
  await assign.getByRole("button", { name: "Assign", exact: true }).click();
  await expect(inst.getByRole("table", { name: "Assignments" })).toContainText(group);
  await instContext.close();

  // 6. As the late joiner: Scheduled at exactly the previewed time.
  const studentApi = await playwright.request.newContext({ baseURL });
  await call(studentApi, "post", "/auth/login", { username: `s9.${id}`, password: latePassword });
  await call(studentApi, "post", "/auth/change-password", {
    currentPassword: latePassword,
    newPassword: "Student-exit-2026",
  });
  expect(await studentExam(studentApi, examIdValue)).toMatchObject({
    status: "SCHEDULED",
    opensAt: "2026-11-24T08:00:00.000Z",
  });

  // 7. The super admin opens it now for that student, with a reason.
  await page.goto(`/exams/${examIdValue}/overrides`);
  await page.getByRole("button", { name: "Open or close now" }).click();
  const override = page.getByRole("dialog", { name: "Open or close now" });
  await override.getByRole("radio", { name: "One student" }).check();
  await override.getByRole("searchbox", { name: "Student" }).fill(`s9.${id}`);
  await override.getByRole("button", { name: `Select Student 9 ${id}` }).click();
  await override.getByRole("textbox", { name: "Reason" }).fill("Approved early sitting");
  await override.getByRole("button", { name: "Open now" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Exam opened" })).toBeVisible();
  expect((await studentExam(studentApi, examIdValue))?.status).toBe("OPEN");
  await page.getByRole("link", { name: "Availability" }).click();
  await expect(
    page.getByRole("table", { name: "Availability" }).getByRole("row", { name: new RegExp(`Student 9 ${id}`) }),
  ).toContainText("Decided by: Student override");
  await studentApi.dispose();

  // 8. The audit log has the whole story, with the right people.
  const auditRow = async (action: string, who: string) => {
    await page.goto("/admin/audit");
    await page.getByRole("combobox", { name: "Action" }).selectOption(action);
    await expect(
      page.getByRole("table", { name: "Audit log" }).getByRole("row").filter({ hasText: who }).first(),
    ).toBeVisible();
  };
  await auditRow("users.imported", "E2E Admin");
  await auditRow("catalog.questions_imported", "E2E Admin");
  await auditRow("rbac.grant_created", "E2E Admin");
  await auditRow("assignments.bulk_created", `Instructor ${id}`);
  await auditRow("overrides.created", "E2E Admin");
});

test("the instructor's sign-in also works from the login page", async ({ browser, apiAs }) => {
  // Guards the helper used above: asUser lands on Login, and a forced change follows a temporary password.
  const admin = await apiAs("admin");
  const u = await call<{ user: { username: string }; temporaryPassword: string }>(admin, "post", "/users", {
    username: `check.${uid("i")
      .toLowerCase()
      .replace(/[^a-z0-9.]/g, "")}`,
    fullName: "Check Login",
    role: "INSTRUCTOR",
  });
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const page = await context.newPage();
  await page.goto("/exams");
  await login(page, u.user.username, u.temporaryPassword);
  await expect(page.getByRole("heading", { name: "Set a new password" })).toBeVisible();
  await context.close();
});
