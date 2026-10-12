import { test as base, expect, request, type APIRequestContext, type Browser, type Page } from "@playwright/test";
import path from "node:path";
import { E2E_PASSWORD, WORLD, type WorldUser } from "../server/scripts/e2e-world";

export { E2E_PASSWORD, expect, WORLD };

/** Saved login (cookie) of a seeded user, written by auth.setup.ts. */
// Playwright runs from the repository root (where playwright.config.ts is).
export const authFile = (who: WorldUser) => path.resolve("e2e", ".auth", `${who}.json`);

/** Unique names per test run, so specs never collide and need no cleanup. */
export const uid = (prefix: string) => `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** Response fields that must never reach a browser. */
const FORBIDDEN_FIELDS = ["passwordHash", "sessionTokenHash", "tokenHash", "isCorrect"];

/**
 * Every test fails if the page logs a JavaScript error, the server answers 5xx, or a response
 * contains a secret field (docs/ADMIN_DASHBOARD_PLAN.md §5.3).
 */
export const test = base.extend<{ guard: void; apiAs: (who: WorldUser) => Promise<APIRequestContext> }>({
  guard: [
    async ({ page }, use) => {
      const problems: string[] = [];
      page.on("pageerror", (e) => problems.push(`page error: ${e.message}`));
      page.on("console", (m) => {
        // Chrome logs every 4xx response as a console error; those are expected (and checked by tests).
        if (m.type() === "error" && !m.text().startsWith("Failed to load resource"))
          problems.push(`console: ${m.text()}`);
      });
      page.on("response", async (r) => {
        if (!r.url().includes("/api/")) return;
        if (r.status() >= 500) problems.push(`${r.status()} ${r.request().method()} ${r.url()}`);
        const type = r.headers()["content-type"] ?? "";
        if (!type.includes("json")) return;
        const body = await r.text().catch(() => "");
        for (const f of FORBIDDEN_FIELDS) if (body.includes(`"${f}"`)) problems.push(`${f} in ${r.url()}`);
      });
      await use();
      expect(problems, "browser errors, server errors or leaked fields").toEqual([]);
    },
    { auto: true },
  ],

  /** An API client logged in as a seeded user, for preconditions that have no screen. */
  apiAs: async ({ baseURL }, use) => {
    const contexts: APIRequestContext[] = [];
    await use(async (who) => {
      const ctx = await request.newContext({ baseURL, storageState: authFile(who) });
      contexts.push(ctx);
      return ctx;
    });
    for (const ctx of contexts) await ctx.dispose();
  },
});

export async function login(page: Page, username: string, password: string) {
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

/** Calls the API and fails loudly on an unexpected status. */
export async function call<T>(
  api: APIRequestContext,
  method: "get" | "post" | "patch" | "put" | "delete",
  url: string,
  data?: unknown,
): Promise<T> {
  const res = await api[method](`/api${url}`, method === "get" ? {} : { data: data ?? {} });
  if (!res.ok()) throw new Error(`${method.toUpperCase()} ${url} → ${res.status()} ${await res.text()}`);
  return (res.status() === 204 ? undefined : await res.json()) as T;
}

export interface CreatedUser {
  id: string;
  username: string;
  fullName: string;
  temporaryPassword: string;
}

/** Creates a user through the API (as the seeded super admin) with a unique username. */
export async function createUser(
  admin: APIRequestContext,
  input: { fullName: string; role?: string; groupIds?: string[]; username?: string },
): Promise<CreatedUser> {
  const username = input.username ?? uid("u").toLowerCase();
  const res = await call<{ user: { id: string }; temporaryPassword: string }>(admin, "post", "/users", {
    username,
    fullName: input.fullName,
    role: input.role ?? "STUDENT",
    groupIds: input.groupIds ?? [],
  });
  return { id: res.user.id, username, fullName: input.fullName, temporaryPassword: res.temporaryPassword };
}

/** The id of a seeded group, by its WORLD key. */
export async function groupId(api: APIRequestContext, key: keyof typeof WORLD.groups): Promise<string> {
  const groups = await call<{ id: string; name: string }[]>(api, "get", "/groups");
  const found = groups.find((g) => g.name === WORLD.groups[key].name);
  if (!found) throw new Error(`group ${key} not seeded`);
  return found.id;
}

/** A fresh instructor who has already set their own password (UI login goes straight in). */
export async function freshStaff(
  admin: APIRequestContext,
  playwright: { request: { newContext: (o: { baseURL: string }) => Promise<APIRequestContext> } },
  baseURL: string,
  name: string,
  grant?: Record<string, unknown>,
) {
  const u = await createUser(admin, { fullName: name, role: "INSTRUCTOR" });
  if (grant) await call(admin, "post", "/rbac/grants", { userId: u.id, ...grant });
  const password = "Instructor-pass-2026";
  const ctx = await playwright.request.newContext({ baseURL });
  await call(ctx, "post", "/auth/login", { username: u.username, password: u.temporaryPassword });
  await call(ctx, "post", "/auth/change-password", { currentPassword: u.temporaryPassword, newPassword: password });
  await ctx.dispose();
  return { ...u, password };
}

/** A separate browser context logged in through the UI, starting at `path`. Close the context when done. */
export async function asUser(browser: Browser, path: string, username: string, password: string) {
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const page = await context.newPage();
  await page.goto(path);
  await login(page, username, password);
  return { context, page };
}

/** The id of a seeded category or exam, by its WORLD key. */
export async function categoryId(api: APIRequestContext, key: keyof typeof WORLD.categories): Promise<string> {
  const all = await call<{ id: string; name: string }[]>(api, "get", "/catalog/categories?includeArchived=true");
  const found = all.find((c) => c.name === WORLD.categories[key].name);
  if (!found) throw new Error(`category ${key} not seeded`);
  return found.id;
}
export async function examId(api: APIRequestContext, key: keyof typeof WORLD.exams): Promise<string> {
  const res = await call<{ items: { id: string; code: string }[] }>(
    api,
    "get",
    `/catalog/exams?q=${WORLD.exams[key].code}`,
  );
  const found = res.items.find((e) => e.code === WORLD.exams[key].code);
  if (!found) throw new Error(`exam ${key} not seeded`);
  return found.id;
}

/** A published exam with a unique code, in a seeded category (or a category id). */
export async function createExam(
  admin: APIRequestContext,
  category: keyof typeof WORLD.categories | { id: string },
  title = uid("E2E Exam"),
): Promise<{ id: string; title: string; code: string }> {
  const categoryIdValue = typeof category === "string" ? await categoryId(admin, category) : category.id;
  const code = `E2E-${uid("X")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(-12)}`;
  const exam = await call<{ id: string }>(admin, "post", "/catalog/exams", {
    code,
    title,
    categoryId: categoryIdValue,
    durationMinutes: 45,
  });
  await call(admin, "patch", `/catalog/exams/${exam.id}`, { status: "PUBLISHED" });
  return { id: exam.id, title, code };
}

/** A group with an intake date and members (late joiners get their own join date). */
export async function createGroup(
  admin: APIRequestContext,
  intakeStartDate: string,
  members: { id: string; joinDate?: string }[] = [],
): Promise<{ id: string; name: string }> {
  const name = `E2E Group ${uid("g")}`;
  const group = await call<{ id: string }>(admin, "post", "/groups", { name, intakeStartDate });
  for (const m of members)
    await call(admin, "post", `/groups/${group.id}/members`, { userIds: [m.id], joinDate: m.joinDate ?? null });
  return { id: group.id, name };
}

/** An API session of a new student who has set their own password: what the student UI will call. */
export async function studentSession(
  admin: APIRequestContext,
  playwright: { request: { newContext: (o: { baseURL: string }) => Promise<APIRequestContext> } },
  baseURL: string,
  fullName: string,
) {
  const u = await createUser(admin, { fullName });
  const api = await playwright.request.newContext({ baseURL });
  await call(api, "post", "/auth/login", { username: u.username, password: u.temporaryPassword });
  await call(api, "post", "/auth/change-password", {
    currentPassword: u.temporaryPassword,
    newPassword: "Student-pass-2026",
  });
  return { ...u, api };
}

export interface StudentExam {
  exam: { id: string; title: string };
  status: string;
  opensAt: string | null;
  closesAt: string | null;
  reason: string;
}
/** The student's own view of one exam (GET /api/student/exams), or undefined when not listed. */
export async function studentExam(api: APIRequestContext, examIdValue: string): Promise<StudentExam | undefined> {
  const rows = await call<StudentExam[]>(api, "get", "/student/exams");
  return rows.find((r) => r.exam.id === examIdValue);
}

/**
 * Clicks a confirmation dialog's button and waits until the dialog has closed, i.e. the action
 * finished. Needed before asserting that something is GONE: while a dialog is open the rest of the
 * page is aria-hidden, so "0 matching rows" would pass before the server has even answered.
 */
export async function confirmDialog(page: Page, dialogName: string | RegExp, button: string) {
  const dialog = page.getByRole("dialog", { name: dialogName });
  await dialog.getByRole("button", { name: button, exact: true }).click();
  await expect(dialog).toBeHidden();
}
