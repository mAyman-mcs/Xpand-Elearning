import { test as base, expect, request, type APIRequestContext, type Page } from "@playwright/test";
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
