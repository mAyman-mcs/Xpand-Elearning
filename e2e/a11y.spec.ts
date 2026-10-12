import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { authFile, call, examId, expect, groupId, test, WORLD } from "./fixtures";

// Accessibility (docs/ADMIN_DASHBOARD_PLAN.md A-D10): axe on every page and the main dialogs, as each
// role. Serious and critical violations fail; at phone width no page may scroll sideways.

async function audit(page: Page, where: string) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  const blocking = results.violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map(
      (v) =>
        `${v.id} (${v.impact}): ${v.help} → ${v.nodes
          .map((n) => n.target.join(" "))
          .slice(0, 3)
          .join(" | ")}`,
    );
  expect(blocking, `accessibility problems on ${where}`).toEqual([]);
}

async function noSidewaysScroll(page: Page, where: string) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, `${where} scrolls sideways at phone width`).toBeLessThanOrEqual(0);
}

/** Opens each page, waits for its heading, checks it at desktop and phone width. */
async function checkPages(page: Page, paths: string[]) {
  for (const path of paths) {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await page.waitForLoadState("networkidle");
    await audit(page, path);
    await page.setViewportSize({ width: 390, height: 844 });
    await noSidewaysScroll(page, path);
  }
}

test.describe("super admin", () => {
  test.use({ storageState: authFile("admin") });

  test("every admin page", async ({ page, apiAs }) => {
    test.setTimeout(120_000);
    const admin = await apiAs("admin");
    const exam = await examId(admin, "cloudGates");
    const instructor = (
      await call<{ items: { id: string }[] }>(admin, "get", `/users?q=${WORLD.users.instCloud.username}`)
    ).items[0]?.id;
    const student = (
      await call<{ items: { id: string }[] }>(admin, "get", `/users?q=${WORLD.users.studentA1.username}`)
    ).items[0]?.id;
    await checkPages(page, [
      "/admin",
      "/admin/users",
      "/admin/users/new",
      `/admin/users/${student}`,
      "/admin/users/import",
      "/admin/groups",
      `/admin/groups/${await groupId(admin, "a")}`,
      "/admin/instructors",
      `/admin/instructors/${instructor}`,
      "/admin/catalog",
      "/admin/audit",
      "/exams",
      "/exams/new",
      `/exams/${exam}`,
      `/exams/${exam}/questions`,
      `/exams/${exam}/materials`,
      `/exams/${exam}/assignments`,
      `/exams/${exam}/overrides`,
      `/exams/${exam}/availability`,
      "/assignments/new",
      "/no/such/page",
    ]);
  });

  test("the main dialogs", async ({ page, apiAs }) => {
    const admin = await apiAs("admin");
    const exam = await examId(admin, "cloudGates");
    const instructor = (
      await call<{ items: { id: string }[] }>(admin, "get", `/users?q=${WORLD.users.instCloud.username}`)
    ).items[0]?.id;
    const dialogs: [string, string][] = [
      ["/admin/groups", "New group"],
      [`/admin/instructors/${instructor}`, "Grant access"],
      [`/exams/${exam}/questions`, "Add question"],
      [`/exams/${exam}/assignments`, "Assign"],
      [`/exams/${exam}/overrides`, "Open or close now"],
    ];
    for (const [path, button] of dialogs) {
      await page.goto(path);
      await page.getByRole("button", { name: button, exact: true }).first().click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await audit(page, `${path} → ${button}`);
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog")).toBeHidden();
    }
  });
});

test.describe("instructor", () => {
  test.use({ storageState: authFile("instCloud") });
  test("their pages", async ({ page, apiAs }) => {
    const exam = await examId(await apiAs("admin"), "cloudGates");
    await checkPages(page, ["/exams", "/students", `/exams/${exam}`, `/exams/${exam}/assignments`, "/admin"]);
  });
});

test.describe("signed out", () => {
  test.use({ storageState: { cookies: [], origins: [] } });
  test("the sign-in page", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
    await audit(page, "sign in");
    await page.setViewportSize({ width: 390, height: 844 });
    await noSidewaysScroll(page, "sign in");
  });
});

test.describe("keyboard only", () => {
  test.use({ storageState: authFile("admin") });
  test("create a group without the mouse", async ({ page }) => {
    await page.goto("/admin/groups");
    await page.getByRole("button", { name: "New group" }).focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "New group" });
    await expect(dialog.getByRole("textbox", { name: "Name" })).toBeFocused();
    const name = `E2E Keyboard ${Date.now()}`;
    await page.keyboard.type(name);
    await page.keyboard.press("Tab");
    await expect(dialog.getByLabel("Intake date")).toBeFocused();
    await dialog.getByLabel("Intake date").fill("2026-11-01"); // date pickers vary by browser; the field itself is reached by Tab
    await page.keyboard.press("Enter"); // submits the form
    await expect(page.getByRole("heading", { name })).toBeVisible();
  });
});
