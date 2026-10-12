import { authFile, call, createUser, E2E_PASSWORD, expect, groupId, login, test, uid, WORLD } from "./fixtures";

test.describe("users (super admin)", () => {
  test.use({ storageState: authFile("admin") });

  test("create a student in a group → credentials shown once → the student must change the password", async ({
    page,
    browser,
  }) => {
    const username = uid("e2e.stu").toLowerCase();
    await page.goto("/admin/users");
    await page.getByRole("link", { name: "New user" }).click();
    await page.getByRole("textbox", { name: "Username" }).fill(username);
    await page.getByRole("textbox", { name: "Full name" }).fill("Salma Created-In-UI");
    await page.getByRole("checkbox", { name: WORLD.groups.a.name }).check();
    await page.getByRole("button", { name: "Create user" }).click();

    const dialog = page.getByRole("dialog", { name: "User created" });
    await expect(dialog).toBeVisible();
    const secrets = dialog.getByTestId("secret-value");
    await expect(secrets.first()).toHaveText(username);
    const temporaryPassword = (await secrets.nth(1).textContent()) ?? "";
    expect(temporaryPassword.length).toBeGreaterThanOrEqual(12);
    await dialog.getByRole("button", { name: "I have saved it" }).click();

    await expect(page.getByRole("heading", { name: "Salma Created-In-UI" })).toBeVisible();
    await expect(page.getByRole("link", { name: WORLD.groups.a.name })).toBeVisible();

    // The new student signs in with the temporary password and is forced to change it.
    const studentContext = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const student = await studentContext.newPage();
    await student.goto("/");
    await login(student, username, temporaryPassword);
    await expect(student.getByRole("heading", { name: "Set a new password" })).toBeVisible();
    await studentContext.close();
  });

  test("validation: bad and duplicate usernames are shown on the field", async ({ page }) => {
    await page.goto("/admin/users/new");
    await page.getByRole("textbox", { name: "Username" }).fill("No Spaces Allowed");
    await page.getByRole("textbox", { name: "Full name" }).fill("Someone");
    await page.getByRole("button", { name: "Create user" }).click();
    await expect(page.getByText("3–50 characters: a-z, 0-9, dot, underscore, dash")).toBeVisible();

    await page.getByRole("textbox", { name: "Username" }).fill(WORLD.users.studentA1.username);
    await page.getByRole("button", { name: "Create user" }).click();
    await expect(page.getByRole("alert")).toHaveText("That username is already taken.");
  });

  test("search and filters", async ({ page, apiAs }) => {
    const unique = uid("Zed");
    await createUser(await apiAs("admin"), { fullName: `${unique} Searchable` });
    await page.goto("/admin/users");
    await page.getByRole("searchbox", { name: "Search" }).fill(unique);
    const table = page.getByRole("table", { name: "Users" });
    await expect(table.getByRole("row")).toHaveCount(2); // header + 1
    await expect(table).toContainText(`${unique} Searchable`);

    await page.getByRole("searchbox", { name: "Search" }).fill("");
    await page.getByRole("combobox", { name: "Role" }).selectOption("INSTRUCTOR");
    await expect(table).toContainText(WORLD.users.instCloud.fullName);
    await expect(table).not.toContainText(WORLD.users.studentA1.fullName);

    await page.getByRole("combobox", { name: "Role" }).selectOption("");
    await page.getByRole("combobox", { name: "Group" }).selectOption({ label: WORLD.groups.b.name });
    await expect(table).toContainText(WORLD.users.studentB1.fullName);
    await expect(table).not.toContainText(WORLD.users.studentA1.fullName);
  });

  test("edit details", async ({ page, apiAs }) => {
    const u = await createUser(await apiAs("admin"), { fullName: "Old Name" });
    await page.goto(`/admin/users/${u.id}`);
    await page.getByRole("textbox", { name: "Full name" }).fill("New Name");
    await page.getByRole("textbox", { name: "Email" }).fill("not-an-email");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("Not a valid email")).toBeVisible();
    await page.getByRole("textbox", { name: "Email" }).fill("new.name@example.com");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Changes saved" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "New Name" })).toBeVisible();
  });

  test("changing the role asks for confirmation", async ({ page, apiAs }) => {
    const u = await createUser(await apiAs("admin"), { fullName: "Future Instructor" });
    await page.goto(`/admin/users/${u.id}`);
    await page.getByRole("combobox", { name: "Role" }).selectOption("INSTRUCTOR");
    await page.getByRole("button", { name: "Save changes" }).click();
    const dialog = page.getByRole("dialog", { name: "Change the role?" });
    await expect(dialog).toContainText("signed out on every device");
    await dialog.getByRole("button", { name: "Change role" }).click();
    await expect(dialog).toBeHidden();
    await page.reload();
    await expect(page.getByRole("combobox", { name: "Role" })).toHaveValue("INSTRUCTOR");
  });

  test("deactivate signs the user out; reactivate restores access", async ({ page, apiAs, playwright, baseURL }) => {
    const u = await createUser(await apiAs("admin"), { fullName: "Dana Deactivated" });
    const userApi = await playwright.request.newContext({ baseURL });
    await call(userApi, "post", "/auth/login", { username: u.username, password: u.temporaryPassword });
    expect((await userApi.get("/api/auth/me")).status()).toBe(200);

    await page.goto(`/admin/users/${u.id}`);
    await page.getByRole("button", { name: "Deactivate" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Deactivate" }).click();
    await expect(page.getByRole("main").getByText("Deactivated").first()).toBeVisible();
    expect((await userApi.get("/api/auth/me")).status()).toBe(401);
    expect(
      (
        await userApi.post("/api/auth/login", { data: { username: u.username, password: u.temporaryPassword } })
      ).status(),
    ).toBe(401);

    await page.getByRole("button", { name: "Reactivate" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Reactivate" }).click();
    await expect(page.getByRole("button", { name: "Deactivate" })).toBeVisible();
    expect(
      (
        await userApi.post("/api/auth/login", { data: { username: u.username, password: u.temporaryPassword } })
      ).status(),
    ).toBe(200);
    await userApi.dispose();
  });

  test("reset password shows a new temporary password once; the old one stops working", async ({
    page,
    apiAs,
    playwright,
    baseURL,
  }) => {
    const u = await createUser(await apiAs("admin"), { fullName: "Rami Reset" });
    await page.goto(`/admin/users/${u.id}`);
    await page.getByRole("button", { name: "Reset password" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Reset password" }).click();
    const secret = page.getByRole("dialog", { name: "Password reset" }).getByTestId("secret-value").nth(1);
    const fresh = (await secret.textContent()) ?? "";
    expect(fresh).not.toBe(u.temporaryPassword);
    await page.getByRole("button", { name: "I have saved it" }).click();
    await expect(page.getByRole("dialog")).toBeHidden();

    const anon = await playwright.request.newContext({ baseURL });
    expect(
      (await anon.post("/api/auth/login", { data: { username: u.username, password: u.temporaryPassword } })).status(),
    ).toBe(401);
    expect((await anon.post("/api/auth/login", { data: { username: u.username, password: fresh } })).status()).toBe(
      200,
    );
    await anon.dispose();
  });

  test("an admin can't change their own role or deactivate themselves", async ({ page, apiAs }) => {
    const me = await call<{ user: { id: string } }>(await apiAs("admin"), "get", "/auth/me");
    await page.goto(`/admin/users/${me.user.id}`);
    await expect(page.getByRole("combobox", { name: "Role" })).toBeDisabled();
    await expect(page.getByText("You can't change your own role.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Deactivate" })).toBeDisabled();
  });

  test("an unknown user id shows not found", async ({ page }) => {
    await page.goto("/admin/users/00000000-0000-4000-8000-000000000000");
    await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
  });
});

test("an expired session returns to login, then back to the same page", async ({ browser }) => {
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const page = await context.newPage();
  await page.goto("/admin/users");
  await login(page, WORLD.users.admin.username, E2E_PASSWORD);
  await expect(page.getByRole("table", { name: "Users" })).toBeVisible();

  await context.clearCookies(); // the server-side session is now unreachable, as after the idle timeout
  await page.getByRole("searchbox", { name: "Search" }).fill("anything");
  await expect(page.getByText("Your session expired.")).toBeVisible();
  await login(page, WORLD.users.admin.username, E2E_PASSWORD);
  await expect(page).toHaveURL(/\/admin\/users$/);
  await expect(page.getByRole("table", { name: "Users" })).toBeVisible();
  await context.close();
});

test.describe("students (instructor)", () => {
  test.use({ storageState: authFile("instCloud") });

  test("sees only students of the groups in their grant, read-only", async ({ page, apiAs }) => {
    await page.goto("/students");
    const table = page.getByRole("table", { name: "Students" });
    await expect(table).toContainText(WORLD.users.studentA1.fullName);
    await expect(table).toContainText(WORLD.users.studentA2.fullName);
    await expect(table).not.toContainText(WORLD.users.studentB1.fullName);
    await expect(table).not.toContainText(WORLD.users.studentNone.fullName);
    await expect(page.getByRole("link", { name: "New user" })).toHaveCount(0);

    await table.getByRole("link", { name: new RegExp(WORLD.users.studentA1.fullName) }).click();
    await expect(page.getByRole("heading", { name: WORLD.users.studentA1.fullName })).toBeVisible();
    await expect(page.getByRole("button", { name: "Reset password" })).toHaveCount(0);

    // A student outside the grant: the same answer as a missing one.
    const admin = await apiAs("admin");
    const outside = await call<{ items: { id: string }[] }>(
      admin,
      "get",
      `/users?groupId=${await groupId(admin, "b")}`,
    );
    await page.goto(`/students/${outside.items[0]?.id}`);
    await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
  });

  test("is refused the admin user pages", async ({ page }) => {
    await page.goto("/admin/users");
    await expect(page.getByRole("heading", { name: "No access" })).toBeVisible();
  });
});

test.describe("instructor without grants", () => {
  test.use({ storageState: authFile("instNone") });
  test("sees a clear message instead of an empty dashboard", async ({ page }) => {
    await page.goto("/students");
    await expect(page.getByText("You have no active access grants")).toBeVisible();
  });
});
