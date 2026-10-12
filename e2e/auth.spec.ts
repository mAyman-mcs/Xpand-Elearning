import { authFile, call, E2E_PASSWORD, expect, login, test, uid, WORLD } from "./fixtures";

test.describe("signing in", () => {
  test("a new user: temporary password → forced change → home → reload → logout → new password", async ({
    page,
    apiAs,
  }) => {
    const admin = await apiAs("admin");
    const username = uid("e2e.new").toLowerCase();
    const { temporaryPassword } = await call<{ temporaryPassword: string }>(admin, "post", "/users", {
      username,
      fullName: "Nadia Newcomer",
    });
    const newPassword = "Fresh-start-2026";

    await page.goto("/");
    await login(page, username, "wrong-password-1");
    await expect(page.getByRole("alert")).toHaveText("Invalid username or password.");

    await login(page, username, temporaryPassword);
    await expect(page.getByRole("heading", { name: "Set a new password" })).toBeVisible();

    const change = async (current: string, next: string, confirm: string) => {
      await page.getByRole("textbox", { name: "Current (temporary) password" }).fill(current);
      await page.getByRole("textbox", { name: "New password", exact: true }).fill(next);
      await page.getByRole("textbox", { name: "Confirm new password" }).fill(confirm);
      await page.getByRole("button", { name: "Save password" }).click();
    };
    await change(temporaryPassword, "short1", "short1");
    await expect(page.getByRole("alert")).toContainText("at least 10 characters");
    await change(temporaryPassword, newPassword, `${newPassword}x`);
    await expect(page.getByRole("alert")).toHaveText("The new passwords do not match.");
    await change(temporaryPassword, "onlyletters", "onlyletters");
    await expect(page.getByRole("alert")).toContainText("letters and numbers");

    await change(temporaryPassword, newPassword, newPassword);
    await expect(page).toHaveURL(/\/student$/);
    await expect(page.getByRole("heading", { name: /Welcome back, Nadia/ })).toBeVisible();

    await page.reload();
    await expect(page.getByRole("heading", { name: /Welcome back, Nadia/ })).toBeVisible();

    await page.getByRole("button", { name: "Logout" }).click();
    await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
    expect((await page.request.get("/api/auth/me")).status()).toBe(401);

    await login(page, username, temporaryPassword);
    await expect(page.getByRole("alert")).toHaveText("Invalid username or password.");
    await login(page, username, newPassword);
    await expect(page.getByRole("heading", { name: /Welcome back, Nadia/ })).toBeVisible();
  });

  test("a deep link survives signing in", async ({ page }) => {
    await page.goto("/admin");
    await login(page, WORLD.users.admin.username, E2E_PASSWORD);
    await expect(page).toHaveURL(/\/admin$/);
    await expect(page.getByRole("heading", { name: /Welcome back/ })).toBeVisible();
  });
});

test.describe("navigation by role", () => {
  test.describe("super admin", () => {
    test.use({ storageState: authFile("admin") });
    test("starts on the dashboard and sees the admin menu", async ({ page }) => {
      await page.goto("/");
      await expect(page).toHaveURL(/\/admin$/);
      const nav = page.getByRole("navigation", { name: "Main" });
      for (const item of ["Dashboard", "Users", "Groups", "Instructors", "Categories & tags", "Exams", "Audit log"])
        await expect(nav.getByRole("link", { name: item })).toBeVisible();
      await expect(page).toHaveTitle(/Dashboard/);
    });

    test("an unknown URL shows the not-found page", async ({ page }) => {
      await page.goto("/no/such/page");
      await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
    });
  });

  test.describe("student", () => {
    test.use({ storageState: authFile("studentA1") });
    test("is refused the admin area and sees only their own menu", async ({ page }) => {
      await page.goto("/admin");
      await expect(page.getByRole("heading", { name: "No access" })).toBeVisible();
      const nav = page.getByRole("navigation", { name: "Main" });
      await expect(nav.getByRole("link")).toHaveText(["My exams"]);
    });
  });
});
