import { describe, expect, it } from "vitest";
import { sessionState } from "./session.js";

const now = new Date("2026-10-01T12:00:00Z");
const base = { revokedAt: null, expiresAt: new Date("2026-10-01T20:00:00Z"), lastSeenAt: now };
const minutesAgo = (m: number) => new Date(now.getTime() - m * 60_000);

describe("sessionState", () => {
  it("is valid when recently active", () => {
    expect(sessionState({ ...base, lastSeenAt: minutesAgo(19) }, now, 20)).toBe("valid");
  });
  it("times out after the idle window", () => {
    expect(sessionState({ ...base, lastSeenAt: minutesAgo(21) }, now, 20)).toBe("idle");
  });
  it("expires at the absolute limit even when active", () => {
    expect(sessionState({ ...base, expiresAt: now }, now, 20)).toBe("expired");
  });
  it("reports revoked sessions first", () => {
    expect(sessionState({ ...base, revokedAt: minutesAgo(1) }, now, 20)).toBe("revoked");
  });
});
