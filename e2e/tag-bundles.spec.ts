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

// A tag given to a group is a live bundle (e.g. "SOC Part 1" → a cohort): the group gets every exam
// with the tag, including exams tagged later, and loses an exam when its tag is taken off.

test.use({ storageState: authFile("admin") });

test("a tag given to a group: every exam with the tag, now and later", async ({ page, apiAs, playwright, baseURL }) => {
  test.setTimeout(90_000);
  const admin = await apiAs("admin");
  const tagName = uid("SOC Part 1");
  const tag = await call<{ id: string }>(admin, "post", "/catalog/tags", { name: tagName });
  const first = await createExam(admin, "cloud", uid("E2E SOC first"));
  const second = await createExam(admin, "networking", uid("E2E SOC second"));
  for (const exam of [first, second]) await call(admin, "put", `/catalog/exams/${exam.id}/tags`, { tagIds: [tag.id] });
  const student = await studentSession(admin, playwright, baseURL ?? "", "Tala Tagged");
  const group = await createGroup(admin, "2026-07-01", [{ id: student.id }]);
  expect(await studentExam(student.api, first.id)).toBeUndefined();

  // ─── Give the tag on the group's page ───
  await page.goto(`/admin/groups/${group.id}`);
  await page.getByRole("button", { name: "Give a tag" }).click();
  const dialog = page.getByRole("dialog", { name: `Give a tag to ${group.name}` });
  await dialog.getByRole("combobox", { name: "Tag" }).selectOption({ label: `${tagName} (2 exams)` });
  await expect(dialog).toContainText("2 exams have this tag now.");
  await dialog.getByRole("radio", { name: "Manual (opened by staff)" }).check();
  await dialog.getByRole("button", { name: "Give the tag" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Tag given" })).toBeVisible();
  const bundles = page.getByRole("table", { name: "Tags given to groups" });
  await expect(bundles.getByRole("row", { name: new RegExp(tagName) })).toContainText("2 exams");

  // The student has both exams (manual: closed until staff open them).
  expect((await studentExam(student.api, first.id))?.status).toBe("CLOSED");
  expect((await studentExam(student.api, second.id))?.status).toBe("CLOSED");

  // The exam page says where the assignment comes from, and offers no Remove for it.
  await page.goto(`/exams/${second.id}/access`);
  const row = page.getByRole("table", { name: "Assignments" }).getByRole("row", { name: new RegExp(group.name) });
  await expect(row).toContainText(`Through the tag ${tagName}`);
  await expect(row.getByRole("button", { name: /Remove the assignment/ })).toHaveCount(0);

  // ─── Live: an exam tagged later is added; an untagged one is removed ───
  const later = await createExam(admin, "cloud", uid("E2E SOC later"));
  await call(admin, "put", `/catalog/exams/${later.id}/tags`, { tagIds: [tag.id] });
  expect(await studentExam(student.api, later.id)).toBeDefined();
  await call(admin, "put", `/catalog/exams/${first.id}/tags`, { tagIds: [] });
  expect(await studentExam(student.api, first.id)).toBeUndefined();

  // ─── Taking the tag away from the group removes its exams ───
  await page.goto(`/admin/groups/${group.id}`);
  await bundles.getByRole("button", { name: `Take “${tagName}” away from ${group.name}` }).click();
  await confirmDialog(page, "Take the tag away?", "Take it away");
  await expect(page.getByText("No tags given yet")).toBeVisible();
  expect(await studentExam(student.api, second.id)).toBeUndefined();
  expect(await studentExam(student.api, later.id)).toBeUndefined();
  await student.api.dispose();
});

test("the bulk page gives a tag to several groups and lists every tag given", async ({ page, apiAs }) => {
  const admin = await apiAs("admin");
  const tagName = uid("SOC Part 2");
  const tag = await call<{ id: string }>(admin, "post", "/catalog/tags", { name: tagName });
  const exam = await createExam(admin, "cloud");
  await call(admin, "put", `/catalog/exams/${exam.id}/tags`, { tagIds: [tag.id] });
  const g1 = await createGroup(admin, "2026-07-01");
  const g2 = await createGroup(admin, "2026-07-01");

  await page.goto("/assignments/new?mode=tags");
  await expect(page.getByRole("radio", { name: /Every exam with a tag/ })).toBeChecked();
  await page.getByRole("combobox", { name: "Tag" }).selectOption({ label: `${tagName} (1 exam)` });
  await page.getByRole("checkbox", { name: g1.name, exact: true }).check();
  await page.getByRole("checkbox", { name: g2.name, exact: true }).check();
  await page.getByRole("radio", { name: "Manual (opened by staff)" }).check();
  await page.getByRole("button", { name: "Give the tag" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Tag given to 2 groups" })).toBeVisible();

  const bundles = page.getByRole("table", { name: "Tags given to groups" });
  await expect(bundles.getByRole("row", { name: new RegExp(`${tagName}.*${g1.name}`) })).toBeVisible();
  await expect(bundles.getByRole("row", { name: new RegExp(`${tagName}.*${g2.name}`) })).toBeVisible();
  // Already given: the group is marked and can't be chosen again.
  await expect(page.getByRole("checkbox", { name: `${g1.name} (has it)` })).toBeDisabled();
});
