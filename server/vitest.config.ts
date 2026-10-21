import { defineConfig } from "vitest/config";

// Two projects: fast unit tests, and integration tests against the xpand_test database
// (see src/test/env.ts). Integration files share one database, so they run one file at a time.
export default defineConfig({
  test: {
    projects: [
      {
        extends: true,
        test: { name: "unit", include: ["src/**/*.test.ts"], exclude: ["src/**/*.int.test.ts"] },
      },
      {
        extends: true,
        test: {
          name: "integration",
          include: ["src/**/*.int.test.ts"],
          globalSetup: ["src/test/global-setup.ts"],
          // One shared database: never run two integration files at once.
          fileParallelism: false,
          testTimeout: 30_000,
        },
      },
    ],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/generated/**", "src/test/**", "src/**/*.test.ts", "src/index.ts"],
      reporter: ["text-summary", "html"],
      thresholds: {
        lines: 80,
        branches: 80,
        // The access-control core is held to a higher bar.
        "src/modules/rbac/**": { lines: 95, branches: 95, functions: 95, statements: 95 },
        "src/modules/assignments/availability.ts": { lines: 95, branches: 95, functions: 95, statements: 95 },
        "src/modules/catalog/**": { lines: 95, branches: 95, functions: 95, statements: 95 },
        // Branches at 90: the rest are race-only recoveries (two starts at once) and null fallbacks.
        "src/modules/attempts/**": { lines: 95, branches: 90, functions: 95, statements: 95 },
      },
    },
  },
});
