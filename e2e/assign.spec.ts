import {
  authFile,
  call,
  createExam,
  createGroup,
  createUser,
  examId,
  expect,
  studentExam,
  studentSession,
  test,
  uid,
  WORLD,
} from "./fixtures";

test.use({ storageState: authFile("admin") });

test("relative schedule: the preview is exactly what each student sees, across the daylight-saving change", async ({
  page,
  apiAs,
  playwright,
  baseURL,
}) => {
  const admin = await apiAs("admin");
  const onTime = await studentSession(admin, playwright, baseURL ?? "", `On Time ${uid("s")}`);
  const late = await studentSession(admin, playwright, baseURL ?? "", `Late Joiner ${uid("s")}`);
  // Intake 1 Oct; the late joiner joins 20 Oct. Day 14 → 15 Oct (summer, UTC+3) and 3 Nov (winter, UTC+2).
  const group = await createGroup(admin, "2026-10-01", [{ id: onTime.id }, { id: late.id, joinDate: "2026-10-20" }]);
  const exam = await createExam(admin, "cloud");

  await page.goto(`/exams/${exam.id}/assignments`);
  await expect(page.getByText("Not assigned to anyone")).toBeVisible();
  await page.getByRole("button", { name: "Assign", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: `Assign “${exam.title}”` });
  await dialog.getByRole("checkbox", { name: new RegExp(group.name) }).check();
  await dialog.getByRole("radio", { name: /Relative to join date/ }).check();
  await dialog.getByRole("spinbutton", { name: "Days after joining" }).fill("14");
  await dialog.getByLabel("At (Cairo time)").fill("10:00");
  await dialog.getByRole("spinbutton", { name: "Open for (hours)" }).fill("2");
  await dialog.getByRole("button", { name: "Preview" }).click();

  const preview = dialog.getByRole("table", { name: "Preview" });
  await expect(preview.getByRole("row", { name: new RegExp(onTime.fullName) })).toContainText(
    "15 Oct 2026, 10:00 Cairo",
  );
  await expect(preview.getByRole("row", { name: new RegExp(onTime.fullName) })).toContainText(
    "15 Oct 2026, 12:00 Cairo",
  );
  await expect(preview.getByRole("row", { name: new RegExp(late.fullName) })).toContainText("3 Nov 2026, 10:00 Cairo");
  await dialog.getByRole("button", { name: "Assign", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "1 assignment created" })).toBeVisible();
  await expect(page.getByRole("table", { name: "Assignments" })).toContainText(
    "Day 14 after joining, 10:00 Cairo, open for 2 h",
  );

  // Each student's own exam list (what their dashboard will show) matches the preview, to the minute.
  expect(await studentExam(onTime.api, exam.id)).toMatchObject({
    opensAt: "2026-10-15T07:00:00.000Z",
    closesAt: "2026-10-15T09:00:00.000Z",
  });
  expect(await studentExam(late.api, exam.id)).toMatchObject({
    opensAt: "2026-11-03T08:00:00.000Z",
    closesAt: "2026-11-03T10:00:00.000Z",
  });

  // Assigning the same group again is refused, and nothing changes.
  await page.getByRole("button", { name: "Assign", exact: true }).click();
  await dialog.getByRole("checkbox", { name: new RegExp(group.name) }).check();
  await dialog.getByRole("radio", { name: /Manual/ }).check();
  await dialog.getByRole("button", { name: "Preview" }).click();
  await dialog.getByRole("button", { name: "Assign", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("already assigned");
  await dialog.getByRole("button", { name: "Cancel" }).click();

  await onTime.api.dispose();
  await late.api.dispose();
});

test("a personal date replaces the group's; reschedule; remove", async ({ page, apiAs, playwright, baseURL }) => {
  const admin = await apiAs("admin");
  const student = await studentSession(admin, playwright, baseURL ?? "", `Make Up ${uid("s")}`);
  const group = await createGroup(admin, "2026-10-01", [{ id: student.id }]);
  const exam = await createExam(admin, "cloud");
  await call(admin, "post", "/assignments", {
    examId: exam.id,
    target: { groupId: group.id },
    schedule: { mode: "FIXED", opensAt: "2026-12-01T08:00:00Z", closesAt: "2026-12-01T10:00:00Z" },
  });

  // A personal make-up date for the one student.
  await page.goto(`/exams/${exam.id}/assignments`);
  await page.getByRole("button", { name: "Assign", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("searchbox", { name: "Individual students" }).fill(student.username);
  await dialog.getByRole("button", { name: `Select ${student.fullName}` }).click();
  await dialog.getByLabel("Opens on (Cairo)").fill("2026-12-05");
  await dialog.getByLabel("Opening time").fill("09:00");
  await dialog.getByRole("button", { name: "Preview" }).click();
  await expect(dialog.getByRole("table", { name: "Preview" })).toContainText("5 Dec 2026, 09:00 Cairo");
  await dialog.getByRole("button", { name: "Assign", exact: true }).click();
  await expect(page.getByRole("table", { name: "Assignments" }).getByRole("row")).toHaveCount(3);
  expect((await studentExam(student.api, exam.id))?.opensAt).toBe("2026-12-05T07:00:00.000Z");

  // Previewing the group's schedule now flags the student whose personal date wins.
  const assignments = page.getByRole("table", { name: "Assignments" });
  await assignments.getByRole("button", { name: `Change the schedule of ${group.name}` }).click();
  const reschedule = page.getByRole("dialog", { name: `Schedule for ${group.name}` });
  await reschedule.getByRole("button", { name: "Preview" }).click();
  await expect(reschedule.getByRole("table", { name: "Preview" })).toContainText("Has a personal date");

  // Reschedule the group to manual.
  await reschedule.getByRole("radio", { name: /Manual/ }).check();
  await reschedule.getByRole("button", { name: "Save schedule" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Schedule changed" })).toBeVisible();
  await expect(assignments.getByRole("row", { name: new RegExp(group.name) })).toContainText("Manual");

  // Remove the personal assignment: the student falls back to the group (manual: closed).
  await assignments.getByRole("button", { name: `Remove the assignment of ${student.fullName}` }).click();
  await page.getByRole("dialog", { name: "Remove this assignment?" }).getByRole("button", { name: "Remove" }).click();
  await expect(assignments.getByRole("row")).toHaveCount(2);
  expect(await studentExam(student.api, exam.id)).toMatchObject({ status: "CLOSED", opensAt: null });
  await student.api.dispose();
});

test("bulk: every exam in a category to a group at once", async ({ page, apiAs }) => {
  const admin = await apiAs("admin");
  const category = await call<{ id: string; name: string }>(admin, "post", "/catalog/categories", {
    name: `E2E Bulk ${uid("c")}`,
  });
  const examA = await createExam(admin, { id: category.id });
  const examB = await createExam(admin, { id: category.id });
  const member = await createUser(admin, { fullName: `Bulk Member ${uid("s")}` });
  const group = await createGroup(admin, "2026-10-01", [{ id: member.id }]);

  await page.goto("/exams");
  await page.getByRole("link", { name: "Assign several exams" }).click();
  await page.getByRole("combobox", { name: "Category" }).selectOption({ label: `${category.name} (2 exams)` });
  await page.getByRole("checkbox", { name: new RegExp(group.name) }).check();
  await page.getByRole("radio", { name: /Manual/ }).check();
  await page.getByRole("button", { name: "Preview" }).click();
  const preview = page.getByRole("table", { name: "Preview" });
  await expect(preview.getByRole("row")).toHaveCount(3); // 2 exams × 1 member
  await expect(preview).toContainText(examA.title);
  await expect(preview).toContainText(examB.title);

  // Changing the choice hides the preview: what is assigned is always what was previewed.
  await page.getByRole("radio", { name: /Fixed dates/ }).check();
  await expect(preview).toHaveCount(0);
  // Back to exactly the previewed request: that preview is valid again.
  await page.getByRole("radio", { name: /Manual/ }).check();
  await expect(preview.getByRole("row")).toHaveCount(3);
  await page.getByRole("button", { name: "Assign", exact: true }).click();
  await expect(page).toHaveURL(/\/exams$/);
  await expect(page.getByRole("status").filter({ hasText: "2 assignments created" })).toBeVisible();

  for (const exam of [examA, examB]) {
    await page.goto(`/exams/${exam.id}/assignments`);
    await expect(page.getByRole("table", { name: "Assignments" })).toContainText(group.name);
  }
});

test.describe("instructor", () => {
  test.use({ storageState: authFile("instCloud") });
  test("can only choose groups in their grant", async ({ page, apiAs }) => {
    await page.goto(`/exams/${await examId(await apiAs("admin"), "cloudGates")}/assignments`);
    await page.getByRole("button", { name: "Assign", exact: true }).click();
    const groups = page.getByRole("dialog").getByRole("group", { name: "Who" });
    await expect(groups.getByRole("checkbox", { name: new RegExp(WORLD.groups.a.name) })).toBeVisible();
    await expect(groups.getByRole("checkbox", { name: new RegExp(WORLD.groups.b.name) })).toHaveCount(0);
  });
});
