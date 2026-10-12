import {
  authFile,
  call,
  confirmDialog,
  createExam,
  createGroup,
  expect,
  studentExam,
  studentSession,
  test,
  uid,
} from "./fixtures";

test.use({ storageState: authFile("admin") });

test("open a manual exam for a group, close it for one student, end the override", async ({
  page,
  apiAs,
  playwright,
  baseURL,
}) => {
  const admin = await apiAs("admin");
  const anna = await studentSession(admin, playwright, baseURL ?? "", `Anna ${uid("s")}`);
  const ben = await studentSession(admin, playwright, baseURL ?? "", `Ben ${uid("s")}`);
  const group = await createGroup(admin, "2026-10-01", [{ id: anna.id }, { id: ben.id }]);
  const exam = await createExam(admin, "cloud");
  await call(admin, "post", "/assignments", {
    examId: exam.id,
    target: { groupId: group.id },
    schedule: { mode: "MANUAL" },
  });
  expect((await studentExam(anna.api, exam.id))?.status).toBe("CLOSED");

  // Open it for the group. A reason is required.
  await page.goto(`/exams/${exam.id}/overrides`);
  await expect(page.getByText("No active overrides")).toBeVisible();
  await page.getByRole("button", { name: "Open or close now" }).click();
  const dialog = page.getByRole("dialog", { name: "Open or close now" });
  await dialog.getByRole("combobox", { name: "Group" }).selectOption({ label: group.name });
  await expect(dialog.getByRole("button", { name: "Open now" })).toBeDisabled();
  await dialog.getByRole("textbox", { name: "Reason" }).fill("Exam day");
  await dialog.getByRole("button", { name: "Open now" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Exam opened" })).toBeVisible();
  const table = page.getByRole("table", { name: "Overrides" });
  await expect(table.getByRole("row", { name: new RegExp(group.name) })).toContainText("Opened");
  expect((await studentExam(anna.api, exam.id))?.status).toBe("OPEN");

  // Close it for Ben only: a student's own override beats the group's.
  await page.getByRole("button", { name: "Open or close now" }).click();
  await dialog.getByRole("radio", { name: "Close the exam" }).check();
  await dialog.getByRole("radio", { name: "One student" }).check();
  await dialog.getByRole("searchbox", { name: "Student" }).fill(ben.username);
  await dialog.getByRole("button", { name: `Select ${ben.fullName}` }).click();
  await dialog.getByRole("textbox", { name: "Reason" }).fill("Left the room");
  await dialog.getByRole("button", { name: "Close now" }).click();
  await expect(table.getByRole("row", { name: new RegExp(ben.fullName) })).toContainText("Closed");
  expect((await studentExam(ben.api, exam.id))?.status).toBe("CLOSED");
  expect((await studentExam(anna.api, exam.id))?.status).toBe("OPEN");

  // The availability view explains each student's state.
  await page.getByRole("link", { name: "Availability" }).click();
  const availability = page.getByRole("table", { name: "Availability" });
  await expect(availability.getByRole("row", { name: new RegExp(anna.fullName) })).toContainText("Open");
  await expect(availability.getByRole("row", { name: new RegExp(anna.fullName) })).toContainText(
    "Decided by: Group override",
  );
  await expect(availability.getByRole("row", { name: new RegExp(ben.fullName) })).toContainText(
    "Decided by: Student override",
  );
  await page.getByRole("combobox", { name: "Status" }).selectOption("CLOSED");
  await expect(availability.getByRole("row")).toHaveCount(2);

  // End Ben's override: he follows the group again.
  await page.getByRole("link", { name: "Open / close" }).click();
  await table.getByRole("button", { name: `End the override for ${ben.fullName}` }).click();
  await confirmDialog(page, "End this override now?", "End now");
  await expect(table.getByRole("row", { name: new RegExp(ben.fullName) })).toHaveCount(0);
  expect((await studentExam(ben.api, exam.id))?.status).toBe("OPEN");
  await page.getByRole("checkbox", { name: "Show ended overrides" }).check();
  await expect(table.getByRole("row", { name: new RegExp(ben.fullName) })).toContainText("Ended");

  await anna.api.dispose();
  await ben.api.dispose();
});
