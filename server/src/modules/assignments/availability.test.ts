import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  anchorFor,
  progressOf,
  resolveAvailability,
  scheduleWindow,
  type AssignmentInput,
  type AttemptInput,
  type ExamInput,
  type OverrideInput,
  type StudentInput,
} from "./availability.js";

// ───────────────────────────── Fixtures ─────────────────────────────

const day = (iso: string) => new Date(`${iso}T00:00:00Z`);
const at = (iso: string) => new Date(iso);
const S = "student-1";
const GA = "group-a";
const GB = "group-b";

const exam: ExamInput = { status: "PUBLISHED", isExternal: false, maxAttempts: 1 };
const student: StudentInput = {
  id: S,
  joinDate: null,
  memberships: [{ groupId: GA, joinDate: null, intakeStartDate: day("2026-07-05") }],
};

let seq = 0;
const assignment = (over: Partial<AssignmentInput>): AssignmentInput => ({
  id: `a${++seq}`,
  userId: null,
  groupId: GA,
  mode: "MANUAL",
  opensAt: null,
  closesAt: null,
  offsetDays: null,
  openTime: null,
  windowMinutes: null,
  ...over,
});
const fixed = (opensAt: string, closesAt: string | null, over: Partial<AssignmentInput> = {}) =>
  assignment({ mode: "FIXED", opensAt: at(opensAt), closesAt: closesAt ? at(closesAt) : null, ...over });
/** Intake 2026-07-05 + 14 days at 10:00 Cairo (UTC+3 in July) = 2026-07-19T07:00Z, for 120 minutes. */
const relative = (over: Partial<AssignmentInput> = {}) =>
  assignment({ mode: "RELATIVE", offsetDays: 14, openTime: "10:00", windowMinutes: 120, ...over });
const override = (action: "OPEN" | "CLOSE", over: Partial<OverrideInput> = {}): OverrideInput => ({
  id: `o${++seq}`,
  userId: null,
  groupId: GA,
  action,
  validFrom: at("2026-01-01T00:00:00Z"),
  validUntil: null,
  createdAt: at("2026-01-01T00:00:00Z"),
  ...over,
});
const attempt = (over: Partial<AttemptInput> = {}): AttemptInput => ({
  status: "SUBMITTED",
  reviewStatus: "PENDING",
  attemptNo: 1,
  ...over,
});

const resolve = (
  now: string,
  parts: {
    assignments?: AssignmentInput[];
    overrides?: OverrideInput[];
    attempts?: AttemptInput[];
    exam?: Partial<ExamInput>;
    student?: Partial<StudentInput>;
  },
) =>
  resolveAvailability({
    now: at(now),
    exam: { ...exam, ...parts.exam },
    student: { ...student, ...parts.student },
    assignments: parts.assignments ?? [],
    overrides: parts.overrides ?? [],
    attempts: parts.attempts ?? [],
  });

// ─────────────────────────────── Tables ───────────────────────────────

describe("resolveAvailability: visibility and exam state", () => {
  it.each([
    ["no assignment at all", {}, "NOT_ASSIGNED"],
    [
      "an assignment for another group",
      { assignments: [fixed("2026-07-01T00:00:00Z", null, { groupId: GB })] },
      "NOT_ASSIGNED",
    ],
    [
      "an assignment for another student",
      { assignments: [fixed("2026-07-01T00:00:00Z", null, { groupId: null, userId: "other" })] },
      "NOT_ASSIGNED",
    ],
    ["an OPEN override without any assignment", { overrides: [override("OPEN")] }, "NOT_ASSIGNED"],
    [
      "a draft exam",
      { assignments: [fixed("2026-07-01T00:00:00Z", null)], exam: { status: "DRAFT" as const } },
      "CLOSED",
    ],
    [
      "an archived exam",
      { assignments: [fixed("2026-07-01T00:00:00Z", null)], exam: { status: "ARCHIVED" as const } },
      "CLOSED",
    ],
    [
      "an archived exam with an OPEN override",
      {
        assignments: [fixed("2026-07-01T00:00:00Z", null)],
        overrides: [override("OPEN")],
        exam: { status: "ARCHIVED" as const },
      },
      "CLOSED",
    ],
    [
      "an external exam (CTF)",
      { assignments: [fixed("2026-07-01T00:00:00Z", null)], exam: { isExternal: true } },
      "EXTERNAL",
    ],
  ])("%s → %s", (_label, parts, status) => {
    expect(resolve("2026-07-10T09:00:00Z", parts).status).toBe(status);
  });
});

describe("resolveAvailability: attempts", () => {
  const assigned = { assignments: [fixed("2026-07-01T00:00:00Z", null)] };

  it.each([
    ["no attempt", [], "OPEN", "NOT_STARTED"],
    ["an attempt in progress (always resumable)", [attempt({ status: "IN_PROGRESS" })], "OPEN", "IN_PROGRESS"],
    ["a submitted attempt (1 allowed)", [attempt()], "SUBMITTED", "ANSWERED"],
    ["an auto-submitted attempt", [attempt({ status: "AUTO_SUBMITTED" })], "SUBMITTED", "ANSWERED"],
    [
      "a force-submitted attempt under review",
      [attempt({ status: "FORCE_SUBMITTED", reviewStatus: "UNDER_REVIEW" })],
      "SUBMITTED",
      "UNDER_REVIEW",
    ],
    ["a reviewed attempt", [attempt({ reviewStatus: "REVIEWED" })], "SUBMITTED", "REVIEWED"],
    ["only a voided attempt (retake allowed)", [attempt({ status: "VOIDED" })], "OPEN", "NOT_STARTED"],
  ] as const)("%s → %s / %s", (_label, attempts, status, progress) => {
    const r = resolve("2026-07-10T09:00:00Z", { ...assigned, attempts: [...attempts] });
    expect([r.status, r.progress]).toEqual([status, progress]);
  });

  it("allows a second attempt when maxAttempts is 2", () => {
    const r = resolve("2026-07-10T09:00:00Z", { ...assigned, attempts: [attempt()], exam: { maxAttempts: 2 } });
    expect([r.status, r.progress]).toEqual(["OPEN", "ANSWERED"]);
  });

  it("an OPEN override never reopens a submitted exam", () => {
    const r = resolve("2026-07-10T09:00:00Z", {
      ...assigned,
      attempts: [attempt()],
      overrides: [override("OPEN", { groupId: null, userId: S })],
    });
    expect(r.status).toBe("SUBMITTED");
  });
});

describe("resolveAvailability: fixed windows (edges)", () => {
  const assignments = [fixed("2026-07-10T07:00:00Z", "2026-07-10T09:00:00Z")];

  it.each([
    ["1 s before opening", "2026-07-10T06:59:59Z", "SCHEDULED"],
    ["at opening (inclusive)", "2026-07-10T07:00:00Z", "OPEN"],
    ["1 s before closing", "2026-07-10T08:59:59Z", "OPEN"],
    ["at closing (exclusive)", "2026-07-10T09:00:00Z", "MISSED"],
    ["long after", "2026-08-01T00:00:00Z", "MISSED"],
  ])("%s → %s", (_label, now, status) => {
    expect(resolve(now, { assignments }).status).toBe(status);
  });

  it("reports the window", () => {
    expect(resolve("2026-07-10T06:00:00Z", { assignments })).toMatchObject({
      opensAt: at("2026-07-10T07:00:00Z"),
      closesAt: at("2026-07-10T09:00:00Z"),
      source: "group-assignment",
    });
  });

  it("an open-ended window stays open", () => {
    expect(resolve("2027-01-01T00:00:00Z", { assignments: [fixed("2026-07-10T07:00:00Z", null)] }).status).toBe("OPEN");
  });

  it("after the window, a student who attempted is CLOSED, not MISSED", () => {
    const r = resolve("2026-07-11T00:00:00Z", { assignments, attempts: [attempt()], exam: { maxAttempts: 2 } });
    expect(r.status).toBe("CLOSED");
  });

  it("a manual-only assignment is closed until staff open it", () => {
    expect(resolve("2026-07-10T08:00:00Z", { assignments: [assignment({})] }).status).toBe("CLOSED");
  });
});

describe("resolveAvailability: relative windows (D9)", () => {
  it.each([
    ["before (intake + 14 d, 10:00 Cairo = 07:00Z)", "2026-07-19T06:59:59Z", "SCHEDULED"],
    ["at opening", "2026-07-19T07:00:00Z", "OPEN"],
    ["after the 120-minute window", "2026-07-19T09:00:00Z", "MISSED"],
  ])("group member, anchored on the intake date: %s → %s", (_label, now, status) => {
    expect(resolve(now, { assignments: [relative()] }).status).toBe(status);
  });

  it("a late joiner is anchored on their own join date", () => {
    const late: Partial<StudentInput> = {
      memberships: [{ groupId: GA, joinDate: day("2026-07-19"), intakeStartDate: day("2026-07-05") }],
    };
    const r = resolve("2026-07-19T08:00:00Z", { assignments: [relative()], student: late });
    expect(r).toMatchObject({ status: "SCHEDULED", opensAt: at("2026-08-02T07:00:00Z") });
  });

  it("a personal relative assignment uses the user's join date", () => {
    const r = resolve("2026-07-01T00:00:00Z", {
      assignments: [relative({ groupId: null, userId: S, offsetDays: 1 })],
      student: { joinDate: day("2026-07-10") },
    });
    expect(r).toMatchObject({ status: "SCHEDULED", opensAt: at("2026-07-11T07:00:00Z"), source: "user-assignment" });
  });

  it("a personal relative assignment without a join date has no window", () => {
    const r = resolve("2026-07-30T00:00:00Z", { assignments: [relative({ groupId: null, userId: S })] });
    expect(r.status).toBe("CLOSED");
  });

  it("keeps 10:00 Cairo across the spring-forward change (UTC+2 → +3)", () => {
    const spring: Partial<StudentInput> = {
      memberships: [{ groupId: GA, joinDate: null, intakeStartDate: day("2026-04-20") }],
    };
    const before = resolve("2026-04-01T00:00:00Z", { assignments: [relative({ offsetDays: 3 })], student: spring });
    const after = resolve("2026-04-01T00:00:00Z", { assignments: [relative({ offsetDays: 5 })], student: spring });
    expect(before.opensAt).toEqual(at("2026-04-23T08:00:00Z"));
    expect(after.opensAt).toEqual(at("2026-04-25T07:00:00Z"));
  });

  it("keeps 10:00 Cairo across the fall-back change (UTC+3 → +2)", () => {
    const autumn: Partial<StudentInput> = {
      memberships: [{ groupId: GA, joinDate: null, intakeStartDate: day("2026-10-26") }],
    };
    const before = resolve("2026-10-01T00:00:00Z", { assignments: [relative({ offsetDays: 3 })], student: autumn });
    const after = resolve("2026-10-01T00:00:00Z", { assignments: [relative({ offsetDays: 4 })], student: autumn });
    expect(before.opensAt).toEqual(at("2026-10-29T07:00:00Z"));
    expect(after.opensAt).toEqual(at("2026-10-30T08:00:00Z"));
  });
});

describe("resolveAvailability: several assignments (D7)", () => {
  const twoGroups: Partial<StudentInput> = {
    memberships: [
      { groupId: GA, joinDate: null, intakeStartDate: day("2026-07-05") },
      { groupId: GB, joinDate: null, intakeStartDate: day("2026-07-05") },
    ],
  };
  const windowA = fixed("2026-07-10T07:00:00Z", "2026-07-10T09:00:00Z", { groupId: GA });
  const windowB = fixed("2026-07-12T07:00:00Z", "2026-07-12T09:00:00Z", { groupId: GB });

  it("group windows add up: open if any window is open", () => {
    expect(resolve("2026-07-12T08:00:00Z", { assignments: [windowA, windowB], student: twoGroups }).status).toBe(
      "OPEN",
    );
  });

  it("shows the earliest upcoming window", () => {
    const r = resolve("2026-07-11T00:00:00Z", { assignments: [windowA, windowB], student: twoGroups });
    expect(r).toMatchObject({ status: "SCHEDULED", opensAt: at("2026-07-12T07:00:00Z") });
  });

  it("overlapping open windows close when the last one closes", () => {
    const longer = fixed("2026-07-10T08:00:00Z", "2026-07-10T11:00:00Z", { groupId: GB });
    const r = resolve("2026-07-10T08:30:00Z", { assignments: [windowA, longer], student: twoGroups });
    expect(r).toMatchObject({
      status: "OPEN",
      opensAt: at("2026-07-10T07:00:00Z"),
      closesAt: at("2026-07-10T11:00:00Z"),
    });
  });

  it("a personal assignment replaces the group ones, even when a group window is open", () => {
    const personal = fixed("2026-07-20T07:00:00Z", "2026-07-20T09:00:00Z", { groupId: null, userId: S });
    const r = resolve("2026-07-10T08:00:00Z", { assignments: [windowA, personal] });
    expect(r).toMatchObject({ status: "SCHEDULED", source: "user-assignment", opensAt: at("2026-07-20T07:00:00Z") });
  });

  it("a manual personal assignment closes the exam for that student despite open group windows", () => {
    const r = resolve("2026-07-10T08:00:00Z", { assignments: [windowA, assignment({ groupId: null, userId: S })] });
    expect(r).toMatchObject({ status: "CLOSED", source: "user-assignment" });
  });
});

describe("resolveAvailability: overrides", () => {
  const scheduled = [fixed("2026-08-01T07:00:00Z", "2026-08-01T09:00:00Z")];
  const now = "2026-07-10T08:00:00Z";

  it.each([
    ["a group OPEN override opens a scheduled exam", [override("OPEN")], "OPEN", "group-override"],
    ["a group CLOSE override closes an open window", [override("CLOSE")], "CLOSED", "group-override"],
    ["group CLOSE beats group OPEN", [override("OPEN"), override("CLOSE")], "CLOSED", "group-override"],
    [
      "a user OPEN beats a group CLOSE",
      [override("CLOSE"), override("OPEN", { groupId: null, userId: S })],
      "OPEN",
      "user-override",
    ],
    [
      "a user CLOSE beats a group OPEN",
      [override("OPEN"), override("CLOSE", { groupId: null, userId: S })],
      "CLOSED",
      "user-override",
    ],
    [
      "an expired override is ignored",
      [override("OPEN", { validUntil: at("2026-07-10T07:00:00Z") })],
      "SCHEDULED",
      "group-assignment",
    ],
    [
      "a future override is ignored",
      [override("OPEN", { validFrom: at("2026-07-11T00:00:00Z") })],
      "SCHEDULED",
      "group-assignment",
    ],
    ["another group's override is ignored", [override("OPEN", { groupId: GB })], "SCHEDULED", "group-assignment"],
  ] as const)("%s", (_label, overrides, status, source) => {
    const r = resolve(now, { assignments: scheduled, overrides: [...overrides] });
    expect([r.status, r.source]).toEqual([status, source]);
  });

  it("the newest user override wins", () => {
    const older = override("OPEN", { groupId: null, userId: S, createdAt: at("2026-07-01T00:00:00Z") });
    const newer = override("CLOSE", { groupId: null, userId: S, createdAt: at("2026-07-02T00:00:00Z") });
    expect(resolve(now, { assignments: scheduled, overrides: [older, newer] }).status).toBe("CLOSED");
  });

  it("an OPEN override with an end time reports when it closes", () => {
    const r = resolve(now, {
      assignments: scheduled,
      overrides: [override("OPEN", { validUntil: at("2026-07-10T10:00:00Z") })],
    });
    expect(r.closesAt).toEqual(at("2026-07-10T10:00:00Z"));
  });
});

describe("defensive cases (prevented upstream by DB constraints or callers)", () => {
  it("a FIXED schedule without an opening time has no window", () => {
    expect(scheduleWindow({ ...assignment({ mode: "FIXED" }) }, null)).toBeNull();
  });

  it("a group assignment has no anchor for a student outside that group", () => {
    expect(anchorFor({ userId: null, groupId: GB }, student)).toBeNull();
  });
});

describe("progressOf", () => {
  it("follows the latest non-voided attempt", () => {
    expect(
      progressOf([
        attempt({ attemptNo: 1, reviewStatus: "REVIEWED" }),
        attempt({ attemptNo: 2, status: "IN_PROGRESS" }),
      ]),
    ).toBe("IN_PROGRESS");
    expect(
      progressOf([attempt({ attemptNo: 1, reviewStatus: "REVIEWED" }), attempt({ attemptNo: 2, status: "VOIDED" })]),
    ).toBe("REVIEWED");
  });
});

// ──────────────────────────── Properties ────────────────────────────

describe("resolveAvailability invariants", () => {
  const instant = fc.date({ min: at("2026-06-01T00:00:00Z"), max: at("2026-09-01T00:00:00Z"), noInvalidDate: true });
  const fixedArb = fc
    .tuple(instant, fc.integer({ min: 1, max: 60 * 24 * 7 }), fc.constantFrom(GA, GB))
    .map(([opensAt, minutes, groupId]) =>
      assignment({ mode: "FIXED", opensAt, closesAt: new Date(opensAt.getTime() + minutes * 60_000), groupId }),
    );
  const overrideArb = fc
    .tuple(fc.constantFrom("OPEN" as const, "CLOSE" as const), instant, fc.option(instant, { nil: null }), fc.boolean())
    .map(([action, validFrom, validUntil, personal]) =>
      override(action, personal ? { groupId: null, userId: S, validFrom, validUntil } : { validFrom, validUntil }),
    );
  const attemptsArb = fc.array(
    fc.record({
      status: fc.constantFrom(
        "SUBMITTED" as const,
        "AUTO_SUBMITTED" as const,
        "VOIDED" as const,
        "IN_PROGRESS" as const,
      ),
      reviewStatus: fc.constantFrom("PENDING" as const, "UNDER_REVIEW" as const, "REVIEWED" as const),
      attemptNo: fc.integer({ min: 1, max: 3 }),
    }),
    { maxLength: 2 },
  );
  const RUNS = { numRuns: 1000 };

  it("without overrides or attempts, it is OPEN exactly when some window contains now", () => {
    fc.assert(
      fc.property(fc.array(fixedArb, { minLength: 1, maxLength: 3 }), instant, (assignments, now) => {
        const r = resolveAvailability({ exam, student, assignments, overrides: [], attempts: [], now });
        const reaching = assignments.filter((a) => a.groupId === GA);
        const inside = reaching.some((a) => a.opensAt! <= now && now < a.closesAt!);
        if (reaching.length === 0) expect(r.status).toBe("NOT_ASSIGNED");
        else expect(r.status === "OPEN").toBe(inside);
      }),
      RUNS,
    );
  });

  it("adding a CLOSE override never makes an exam open (unless an attempt is in progress)", () => {
    fc.assert(
      fc.property(
        fc.array(fixedArb, { maxLength: 3 }),
        fc.array(overrideArb, { maxLength: 3 }),
        instant,
        attemptsArb,
        (assignments, overrides, now, attempts) => {
          const closeAll = override("CLOSE", { groupId: null, userId: S, createdAt: at("2099-01-01T00:00:00Z") });
          const r = resolveAvailability({
            exam,
            student,
            assignments,
            overrides: [...overrides, closeAll],
            attempts,
            now,
          });
          if (progressOf(attempts) !== "IN_PROGRESS") expect(r.status).not.toBe("OPEN");
        },
      ),
      RUNS,
    );
  });

  it("SUBMITTED is stable under any overrides", () => {
    fc.assert(
      fc.property(
        fc.array(fixedArb, { minLength: 1, maxLength: 3 }),
        fc.array(overrideArb, { maxLength: 4 }),
        instant,
        (assignments, overrides, now) => {
          const reaching = [...assignments, assignment({})];
          const r = resolveAvailability({
            exam,
            student,
            assignments: reaching,
            overrides,
            attempts: [attempt()],
            now,
          });
          expect(r.status).toBe("SUBMITTED");
        },
      ),
      RUNS,
    );
  });

  it("never reports a progress that contradicts the attempts", () => {
    fc.assert(
      fc.property(fc.array(fixedArb, { maxLength: 3 }), attemptsArb, instant, (assignments, attempts, now) => {
        const r = resolveAvailability({ exam, student, assignments, overrides: [], attempts, now });
        expect(r.progress).toBe(progressOf(attempts));
      }),
      RUNS,
    );
  });
});
