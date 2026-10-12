import { authFile, createUser, expect, test, uid, WORLD } from "./fixtures";

test.use({ storageState: authFile("admin") });

test("create a group, add students, set a late joiner, remove a member", async ({ page, apiAs }) => {
  const admin = await apiAs("admin");
  const tag = uid("Grp");
  const first = await createUser(admin, { fullName: `${tag} First` });
  const second = await createUser(admin, { fullName: `${tag} Second` });
  const name = `E2E Intake ${tag}`;

  await page.goto("/admin/groups");
  await page.getByRole("button", { name: "New group" }).click();
  const create = page.getByRole("dialog", { name: "New group" });
  await create.getByRole("textbox", { name: "Name" }).fill(name);
  await create.getByLabel("Intake date").fill("2026-09-01");
  await create.getByRole("button", { name: "Create group" }).click();
  await expect(page.getByRole("heading", { name })).toBeVisible();
  await expect(page.getByText("No members yet")).toBeVisible();

  // Add both students with the picker.
  await page.getByRole("button", { name: "Add students" }).click();
  const add = page.getByRole("dialog", { name: `Add students to ${name}` });
  await add.getByRole("searchbox", { name: "Find students" }).fill(tag);
  await add.getByRole("button", { name: `Select ${first.fullName}` }).click();
  await add.getByRole("button", { name: `Select ${second.fullName}` }).click();
  await expect(add.getByRole("list", { name: "Selected" }).getByRole("listitem")).toHaveCount(2);
  await add.getByRole("button", { name: "Add 2 students" }).click();
  await expect(page.getByRole("status").filter({ hasText: "2 students added" })).toBeVisible();

  const members = page.getByRole("table", { name: "Members" });
  await expect(members.getByRole("row")).toHaveCount(3);
  await expect(page.getByText("2 members")).toBeVisible();

  // A late joiner: their relative schedules count from their own date.
  await members.getByRole("button", { name: `Change join date of ${second.fullName}` }).click();
  const joinDialog = page.getByRole("dialog", { name: `Join date of ${second.fullName}` });
  await joinDialog.getByLabel("Join date").fill("2026-09-15");
  await joinDialog.getByRole("button", { name: "Save" }).click();
  const secondRow = members.getByRole("row", { name: new RegExp(second.fullName) });
  await expect(secondRow).toContainText("15 Sept 2026");
  await expect(secondRow).toContainText("Late joiner");

  // Back to the intake date.
  await members.getByRole("button", { name: `Change join date of ${second.fullName}` }).click();
  await joinDialog.getByRole("button", { name: "Use the intake date" }).click();
  await expect(secondRow).toContainText("(intake)");

  // Remove the first student.
  await members.getByRole("button", { name: `Remove ${first.fullName}` }).click();
  await page.getByRole("dialog", { name: "Remove from the group?" }).getByRole("button", { name: "Remove" }).click();
  await expect(members.getByRole("row")).toHaveCount(2);
  await expect(members).not.toContainText(first.fullName);

  // The student's own page lists the group.
  await members.getByRole("link", { name: new RegExp(second.fullName) }).click();
  await expect(page.getByRole("link", { name })).toBeVisible();
});

test("a duplicate group name is refused", async ({ page }) => {
  await page.goto("/admin/groups");
  await page.getByRole("button", { name: "New group" }).click();
  const create = page.getByRole("dialog", { name: "New group" });
  await create.getByRole("textbox", { name: "Name" }).fill(WORLD.groups.a.name);
  await create.getByLabel("Intake date").fill("2026-09-01");
  await create.getByRole("button", { name: "Create group" }).click();
  await expect(create.getByRole("alert")).toHaveText("A group with that name already exists.");
});

test("edit a group's intake date", async ({ page }) => {
  const name = `E2E Edit ${uid("g")}`;
  await page.goto("/admin/groups");
  await page.getByRole("button", { name: "New group" }).click();
  const create = page.getByRole("dialog", { name: "New group" });
  await create.getByRole("textbox", { name: "Name" }).fill(name);
  await create.getByLabel("Intake date").fill("2026-09-01");
  await create.getByRole("button", { name: "Create group" }).click();
  await expect(page.getByRole("heading", { name })).toBeVisible();

  await page.getByLabel("Intake date").fill("2026-10-01");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Group saved" })).toBeVisible();
  await expect(page.getByText("Intake 1 Oct 2026")).toBeVisible();
});
