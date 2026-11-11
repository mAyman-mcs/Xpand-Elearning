import { describe, expect, it } from "vitest";
import { passwordChecks } from "./password";

const failing = (password: string, username = "lina.l") =>
  passwordChecks(password, username)
    .filter((c) => !c.ok)
    .map((c) => c.label);

describe("password checklist", () => {
  it("accepts a password that meets every rule", () => {
    expect(failing("blue-river-2026")).toEqual([]);
  });

  it("names each missing rule", () => {
    expect(failing("short1")).toEqual(["At least 10 characters"]);
    expect(failing("onlyletters-here")).toEqual(["Letters and numbers"]);
    expect(failing("LINA.L-2026-pass")).toEqual(["Doesn't contain your username"]);
  });

  it("shows nothing as met before typing", () => {
    expect(failing("")).toHaveLength(3);
  });
});
