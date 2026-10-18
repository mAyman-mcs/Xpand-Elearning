import { asUser, authFile, call, createUser, expect, insertSubmittedAttempt, test, uid } from "./fixtures";

// The SOC scenario through the UI: an exam with only its required fields, a student in a batch,
// an instructor whose only access is the "soc" tag for students who submitted, and the tag put on
// the exam. The instructor reaches that exam, and a student only once they have submitted it.

test.use({ storageState: authFile("admin") });

test("soc tag grant: the instructor sees the soc exam and only students who submitted it", async ({
  page,
  browser,
  apiAs,
}) => {
  test.setTimeout(120_000);
  const admin = await apiAs("admin");
  const id = uid("s")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  const category = await call<{ id: string; name: string }>(admin, "post", "/catalog/categories", {
    name: `Security ${id}`,
  });

  // 1. An exam with only the required fields (title, code, category; duration is pre-filled).
  const examTitle = `SOC Analyst ${id}`;
  await page.goto("/exams/new");
  await page.getByRole("textbox", { name: "Title" }).fill(examTitle);
  await page.getByRole("textbox", { name: "Code" }).fill(`SOC-${id}`.slice(0, 31));
  await page.getByRole("combobox", { name: "Category" }).selectOption({ label: category.name });
  await page.getByRole("button", { name: "Create exam" }).click();
  await expect(page.getByRole("heading", { name: examTitle })).toBeVisible();
  const examId = new URL(page.url()).pathname.split("/")[2] ?? "";

  // 2. A batch, a student in it (through the UI) and a classmate.
  const batch = `Batch ${id}`;
  await page.goto("/admin/groups");
  await page.getByRole("button", { name: "New group" }).click();
  const newGroup = page.getByRole("dialog", { name: "New group" });
  await newGroup.getByRole("textbox", { name: "Name" }).fill(batch);
  await newGroup.getByLabel("Intake date").fill("2026-10-01");
  await newGroup.getByRole("button", { name: "Create group" }).click();
  await expect(page.getByRole("heading", { name: batch })).toBeVisible();
  const batchId = new URL(page.url()).pathname.split("/")[3] ?? "";

  await page.goto("/admin/users/new");
  await page.getByRole("textbox", { name: "Username" }).fill(`soc.${id}`);
  await page.getByRole("textbox", { name: "Full name" }).fill(`Sara Submitter ${id}`);
  await page.getByRole("checkbox", { name: batch }).check();
  await page.getByRole("button", { name: "Create user" }).click();
  await page.getByRole("dialog", { name: "User created" }).getByRole("button", { name: "I have saved it" }).click();
  const studentId = new URL(page.url()).pathname.split("/")[3] ?? "";
  const classmate = await createUser(admin, { fullName: `Carl Classmate ${id}`, groupIds: [batchId] });
  await call(admin, "post", "/assignments", { examId, target: { groupId: batchId }, schedule: { mode: "MANUAL" } });

  // 3. The soc tag, and an instructor whose only grant is that tag, for students who submitted.
  await page.goto("/admin/catalog");
  await page.getByRole("textbox", { name: "New tag" }).fill("soc");
  await page
    .locator("form")
    .filter({ has: page.getByRole("textbox", { name: "New tag" }) })
    .getByRole("button", { name: "Add" })
    .click();
  await expect(page.getByRole("table", { name: "Tags" })).toContainText("soc");

  const instructor = await createUser(admin, { fullName: `Ines Soc ${id}`, role: "INSTRUCTOR" });
  await page.goto(`/admin/instructors/${instructor.id}`);
  await page.getByRole("button", { name: "Grant access" }).click();
  const editor = page.getByRole("dialog", { name: `New access for Ines Soc ${id}` });
  await editor.getByRole("checkbox", { name: "View results" }).check();
  await editor.getByRole("checkbox", { name: "Edit exams and questions" }).check();
  await editor.getByRole("checkbox", { name: "soc", exact: true }).check();
  await editor.getByRole("radio", { name: "Only students who submitted these exams" }).check();
  await expect(editor.getByTestId("grant-preview")).toHaveText(
    "Can view results and edit exams and questions for exams tagged “soc”, for only students who have submitted one of these exams.",
  );
  await editor.getByRole("button", { name: "Grant access" }).click();
  await expect(page.getByRole("list", { name: "Grants" })).toContainText("exams tagged “soc”");

  // The tag is now an access tag.
  await page.goto("/admin/catalog");
  await expect(page.getByRole("table", { name: "Tags" }).getByRole("row", { name: /soc/ })).toContainText(
    "Access · 1 grant",
  );

  // 4. The super admin puts the soc tag on the exam.
  await page.goto(`/exams/${examId}`);
  await page.getByRole("button", { name: /^soc/ }).click();
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Exam saved" })).toBeVisible();

  // 5. The instructor: the soc exam only, and no students yet.
  const { context, page: inst } = await asUser(browser, "/exams", instructor.username, instructor.temporaryPassword);
  await inst.getByRole("textbox", { name: "Current (temporary) password" }).fill(instructor.temporaryPassword);
  await inst.getByRole("textbox", { name: "New password", exact: true }).fill("Soc-instructor-2026");
  await inst.getByRole("textbox", { name: "Confirm new password" }).fill("Soc-instructor-2026");
  await inst.getByRole("button", { name: "Save password" }).click();
  const exams = inst.getByRole("table", { name: "Exams" });
  await expect(exams.getByRole("row")).toHaveCount(2);
  await expect(exams).toContainText(examTitle);
  await inst.goto("/students");
  await expect(inst.getByText("No users match")).toBeVisible();

  // Strict: the instructor may edit this exam but can't take the access tag off it.
  await inst.goto(`/exams/${examId}`);
  await expect(inst.getByRole("button", { name: /^soc/ })).toBeDisabled();
  await expect(inst.getByText("only a super admin can add or remove them")).toBeVisible();

  // 6. The student submits the soc exam: now exactly that student is visible.
  await insertSubmittedAttempt(examId, studentId);
  await inst.goto("/students");
  const students = inst.getByRole("table", { name: "Students" });
  await expect(students.getByRole("row")).toHaveCount(2);
  await expect(students).toContainText(`Sara Submitter ${id}`);
  await expect(students).not.toContainText(classmate.fullName);
  await inst.goto(`/students/${classmate.id}`);
  await expect(inst.getByRole("heading", { name: "Page not found" })).toBeVisible();
  await inst.goto(`/exams/${examId}/availability`);
  const availability = inst.getByRole("table", { name: "Availability" });
  await expect(availability.getByRole("row")).toHaveCount(2);
  await expect(availability).toContainText(`Sara Submitter ${id}`);
  await context.close();
});
