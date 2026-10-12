import { authFile, call, createUser, expect, login, test, WORLD } from "./fixtures";
import type { Browser } from "@playwright/test";

test.use({ storageState: authFile("admin") });

/** A fresh instructor who has already set their own password, so the UI login goes straight in. */
async function freshInstructor(
  admin: Parameters<typeof createUser>[0],
  playwright: typeof import("@playwright/test"),
  baseURL: string,
  name: string,
) {
  const u = await createUser(admin, { fullName: name, role: "INSTRUCTOR" });
  const password = "Instructor-pass-2026";
  const ctx = await playwright.request.newContext({ baseURL });
  await call(ctx, "post", "/auth/login", { username: u.username, password: u.temporaryPassword });
  await call(ctx, "post", "/auth/change-password", { currentPassword: u.temporaryPassword, newPassword: password });
  await ctx.dispose();
  return { ...u, password };
}

async function asInstructor(browser: Browser, username: string, password: string) {
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const page = await context.newPage();
  await page.goto("/students");
  await login(page, username, password);
  return { context, page };
}

test("grant, edit and remove an instructor's access, and the instructor sees exactly that", async ({
  page,
  browser,
  apiAs,
  playwright,
  baseURL,
}) => {
  const inst = await freshInstructor(await apiAs("admin"), playwright, baseURL ?? "", "Gina Granted");

  // No access yet.
  await page.goto("/admin/instructors");
  const row = page.getByRole("table", { name: "Instructors" }).getByRole("row", { name: /Gina Granted/ });
  await expect(row).toContainText("No access");
  await row.getByRole("link").click();
  await expect(page.getByText("This instructor sees nothing until you grant access.")).toBeVisible();

  // Grant: assign + schedule, category Cloud, Group A.
  await page.getByRole("button", { name: "Grant access" }).click();
  const editor = page.getByRole("dialog", { name: "New access for Gina Granted" });
  await expect(editor.getByRole("button", { name: "Grant access" })).toBeDisabled();
  await editor.getByRole("checkbox", { name: "Assign exams" }).check();
  await editor.getByRole("checkbox", { name: "Schedule and open/close exams" }).check();
  // exact: the exam "E2E Cloud Gates" also contains the category name.
  await editor.getByRole("checkbox", { name: WORLD.categories.cloud.name, exact: true }).check();
  await editor.getByRole("checkbox", { name: WORLD.groups.a.name }).check();
  await editor.getByLabel("Expires after (Cairo date, optional)").fill("2020-01-01");
  await expect(editor.getByText("The expiry date is in the past.")).toBeVisible();
  await editor.getByLabel("Expires after (Cairo date, optional)").fill("2099-12-31");
  await expect(editor.getByTestId("grant-preview")).toHaveText(
    `Can assign exams and schedule and open/close exams for exams in ${WORLD.categories.cloud.name}, for students in ${WORLD.groups.a.name}, until 31 Dec 2099, 23:59 Cairo.`,
  );
  await editor.getByRole("button", { name: "Grant access" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Access granted" })).toBeVisible();
  const grants = page.getByRole("list", { name: "Grants" });
  await expect(grants.getByRole("listitem")).toHaveCount(1);
  await expect(grants).toContainText("Active");

  // The instructor sees Group A's students only, and Cloud exams only (checked through the API they use).
  const { context, page: instPage } = await asInstructor(browser, inst.username, inst.password);
  const students = instPage.getByRole("table", { name: "Students" });
  await expect(students).toContainText(WORLD.users.studentA1.fullName);
  await expect(students).not.toContainText(WORLD.users.studentB1.fullName);
  const exams = await (await instPage.request.get("/api/catalog/exams")).json();
  expect(exams.items.map((e: { code: string }) => e.code)).toEqual([WORLD.exams.cloudGates.code]);

  // Edit: Group B instead of Group A → applies on the instructor's next page load.
  await grants.getByRole("button", { name: "Edit" }).click();
  const edit = page.getByRole("dialog", { name: "Edit access of Gina Granted" });
  await edit.getByRole("checkbox", { name: WORLD.groups.a.name }).uncheck();
  await edit.getByRole("checkbox", { name: WORLD.groups.b.name }).check();
  await edit.getByRole("button", { name: "Save access" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Access updated" })).toBeVisible();
  await expect(grants).toContainText(`for students in ${WORLD.groups.b.name}`);

  await instPage.reload();
  await expect(students).toContainText(WORLD.users.studentB1.fullName);
  await expect(students).not.toContainText(WORLD.users.studentA1.fullName);

  // Remove: the instructor loses everything.
  await grants.getByRole("button", { name: "Remove" }).click();
  await page
    .getByRole("dialog", { name: "Remove this access?" })
    .getByRole("button", { name: "Remove access" })
    .click();
  await expect(page.getByText("This instructor sees nothing until you grant access.")).toBeVisible();
  await instPage.reload();
  await expect(instPage.getByText("You have no active access grants")).toBeVisible();
  await context.close();
});

test("the seeded instructor's grant reads as a sentence", async ({ page }) => {
  await page.goto("/admin/instructors");
  await page.getByRole("link", { name: new RegExp(WORLD.users.instCloud.fullName) }).click();
  await expect(page.getByRole("list", { name: "Grants" })).toContainText(
    `Can edit exams and questions, assign exams, schedule and open/close exams and view results for exams in ${WORLD.categories.cloud.name}, for students in ${WORLD.groups.a.name}.`,
  );
});

test("a non-instructor has no grant page", async ({ page, apiAs }) => {
  const student = await createUser(await apiAs("admin"), { fullName: "Not An Instructor" });
  await page.goto(`/admin/instructors/${student.id}`);
  await expect(page.getByText("Not An Instructor is not an instructor")).toBeVisible();
});
