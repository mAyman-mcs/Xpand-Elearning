import { authFile, createUser, expect, test, uid, WORLD } from "./fixtures";

test.use({ storageState: authFile("admin") });

test("an action done in the UI appears in the audit log with its actor, target and details", async ({ page }) => {
  const name = `E2E Audited ${uid("g")}`;
  await page.goto("/admin/groups");
  await page.getByRole("button", { name: "New group" }).click();
  const dialog = page.getByRole("dialog", { name: "New group" });
  await dialog.getByRole("textbox", { name: "Name" }).fill(name);
  await dialog.getByLabel("Intake date").fill("2026-09-01");
  await dialog.getByRole("button", { name: "Create group" }).click();
  await expect(page.getByRole("heading", { name })).toBeVisible();

  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Audit log" }).click();
  await page.getByRole("combobox", { name: "Action" }).selectOption("groups.created");
  const log = page.getByRole("table", { name: "Audit log" });
  const row = log
    .getByRole("row")
    .filter({ hasText: "groups.created" })
    .filter({ hasText: WORLD.users.admin.fullName })
    .first();
  await expect(row).toBeVisible();
  await expect(log.getByRole("row").filter({ hasNotText: "groups.created" }).filter({ hasText: "users." })).toHaveCount(
    0,
  );

  // The newest groups.created entry is ours: its details name the group, and the target opens it.
  const newest = log.getByRole("row").nth(1);
  await newest.getByText("Show").click();
  await expect(newest).toContainText(name);
  await newest.getByRole("link", { name: /^Group / }).click();
  await expect(page.getByRole("heading", { name })).toBeVisible();
});

test("a user's history shows only entries about that user", async ({ page, apiAs }) => {
  const u = await createUser(await apiAs("admin"), { fullName: "Hana History" });
  await page.goto(`/admin/users/${u.id}`);
  await page.getByRole("textbox", { name: "Full name" }).fill("Hana History-Renamed");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Changes saved" })).toBeVisible();

  await page.getByRole("link", { name: "View history" }).click();
  await expect(page.getByText("Showing the history of one user only.")).toBeVisible();
  const rows = page.getByRole("table", { name: "Audit log" }).getByRole("row");
  await expect(rows).toHaveCount(3); // header, users.updated, users.created
  await expect(rows.nth(1)).toContainText("users.updated");
  await expect(rows.nth(2)).toContainText("users.created");

  await page.getByRole("button", { name: "Show everything" }).click();
  await expect(page.getByText("Showing the history of one user only.")).toBeHidden();
});

test("filters by person and date range", async ({ page }) => {
  await page.goto("/admin/audit");
  await page.getByRole("button", { name: "Anyone" }).click();
  await page.getByRole("searchbox", { name: "Find a person" }).fill(WORLD.users.instNone.username);
  await page.getByRole("button", { name: `Select ${WORLD.users.instNone.fullName}` }).click();
  // The seeded instructor only ever logged in (setup): every entry is theirs and is a sign-in.
  const log = page.getByRole("table", { name: "Audit log" });
  await expect(log.getByRole("row").nth(1)).toContainText("auth.login");
  await expect(log.getByRole("row").filter({ hasNotText: WORLD.users.instNone.fullName })).toHaveCount(1); // header

  await page.getByRole("button", { name: "Clear the person filter" }).click();
  await page.getByLabel("From (Cairo date)").fill("2099-01-01");
  await expect(page.getByText("No entries match")).toBeVisible();
});

test.describe("instructors", () => {
  test.use({ storageState: authFile("instCloud") });
  test("don't see the audit log yet", async ({ page }) => {
    await expect(async () => {
      await page.goto("/admin/audit");
      await expect(page.getByRole("heading", { name: "No access" })).toBeVisible();
    }).toPass();
    await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Audit log" })).toHaveCount(
      0,
    );
  });
});
