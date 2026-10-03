import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "**/coverage/**",
      "server/src/generated/**",
      "server/*.config.ts",
      "web/*.config.ts",
      // Legacy Apps Script prototype, kept for reference only.
      "frontend.html",
      "frontend.js",
      "test/**",
    ],
  },

  // ── Server: strict, type-aware ──
  {
    files: ["server/**/*.ts"],
    extends: [js.configs.recommended, ...tseslint.configs.strictTypeChecked],
    languageOptions: {
      globals: globals.node,
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      "no-console": "error",
      "no-restricted-syntax": ["error", { selector: "ExportDefaultDeclaration", message: "Use named exports." }],
      "@typescript-eslint/no-non-null-assertion": "error",
      "@typescript-eslint/restrict-template-expressions": ["error", { allowNumber: true }],
      // Express 5 awaits async handlers and forwards rejections to the error handler.
      "@typescript-eslint/no-misused-promises": ["error", { checksVoidReturn: { arguments: false } }],
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      // Over 60% of lint time (it walks Prisma's large generated types) for little value here:
      // Prisma enums are plain string-literal unions.
      "@typescript-eslint/no-unsafe-enum-assignment": "off",
    },
  },
  {
    files: ["server/**/*.test.ts", "server/src/test/**"],
    rules: {
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
    },
  },
  // Vitest requires a default export from global setup files.
  { files: ["server/src/test/global-setup.ts"], rules: { "no-restricted-syntax": "off" } },
  // CLI scripts talk to the operator on the console.
  { files: ["server/scripts/**"], rules: { "no-console": "off" } },

  // ── Web: baseline rules (frontend work has its own guide) ──
  {
    files: ["web/src/**/*.{ts,tsx}"],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: { globals: globals.browser },
  },
);
