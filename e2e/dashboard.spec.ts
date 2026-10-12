import { authFile, call, createUser, expect, test } from "./fixtures";

test.use({ storageState: authFile("admin") });

const statValue = async (page: import("@playwright/test").Page, label: string) => {
  const card = page.getByRole("link", { name: new RegExp(`^${label}: \\d+$`) });
  const name = (await card.getAttribute("aria-label")) ?? "";
  return Number(name.split(": ")[1]);
};

test("the numbers match the server and link to the lists behind them", async ({ page, apiAs }) => {
  const stats = await call<{ users: { students: number } }>(await apiAs("admin"), "get", "/admin/stats");
  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "People" })).toBeVisible();
  // Other specs run in parallel and create students: the dashboard shows at least what the API said.
  expect(await statValue(page, "Students")).toBeGreaterThanOrEqual(stats.users.students);

  await page.getByRole("link", { name: /^Students: / }).click();
  await expect(page).toHaveURL(/\/admin\/users\?role=STUDENT$/);
  await expect(page.getByRole("combobox", { name: "Role" })).toHaveValue("STUDENT");

  await page.goto("/admin");
  await page.getByRole("link", { name: /^Groups: / }).click();
  await expect(page.getByRole("heading", { name: "Groups" })).toBeVisible();
});

test("locked accounts are counted and highlighted", async ({ page, apiAs, playwright, baseURL }) => {
  const u = await createUser(await apiAs("admin"), { fullName: "Lucas Locked" });
  const anon = await playwright.request.newContext({ baseURL });
  for (let i = 0; i < 5; i++)
    await anon.post("/api/auth/login", { data: { username: u.username, password: "wrong-password-0" } });
  await anon.dispose();

  await page.goto("/admin");
  expect(await statValue(page, "Locked accounts")).toBeGreaterThanOrEqual(1);
  await page.goto(`/admin/users/${u.id}`);
  await expect(page.getByRole("main").getByText("Locked").first()).toBeVisible();
  // A password reset unlocks.
  await page.getByRole("button", { name: "Reset password" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Reset password" }).click();
  await page.getByRole("button", { name: "I have saved it" }).click();
  await expect(page.getByRole("main").getByText("Active").first()).toBeVisible();
});
