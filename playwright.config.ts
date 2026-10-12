import { defineConfig, devices } from "@playwright/test";

// Browser integration tests: the real app (built server + built web, one origin) against its own
// database. `npm run e2e` builds first; see docs/ADMIN_DASHBOARD_PLAN.md §5.
const port = process.env.E2E_PORT ?? "8090";
const baseURL = `http://localhost:${port}`;

export default defineConfig({
  testDir: "e2e",
  outputDir: "e2e/test-results",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [["list"], ["html", { outputFolder: "e2e/report", open: "never" }]] : [["list"]],
  timeout: 30_000,
  expect: { timeout: 7_000 },
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    timezoneId: "Europe/London", // deliberately NOT Cairo: the UI must show Cairo time regardless
  },
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
      dependencies: ["setup"],
      testIgnore: /auth\.setup\.ts/,
    },
  ],
  webServer: {
    command: "node e2e/start-server.mjs",
    url: `${baseURL}/api/health/ready`,
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
