import { describe, expect, it } from "vitest";
import { slugify } from "./slug.js";

describe("slugify", () => {
  it.each([
    ["Cloud Security / 101", "cloud-security-101"],
    ["  OSI  Model ", "osi-model"],
    ["Café Résumé", "cafe-resume"],
    ["---", ""],
  ])("%s → %s", (input, expected) => {
    expect(slugify(input)).toBe(expected);
  });
});
