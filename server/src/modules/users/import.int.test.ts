import type request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createTestApp, resetDb } from "../../test/app.js";
import { loginAs } from "../../test/http.js";
import { seedWorld, type World } from "../../test/rbac-world.js";

const { app, db } = createTestApp();
let w: World;
let admin: request.Agent;

beforeEach(async () => {
  await resetDb(db);
  w = await seedWorld(db);
  admin = await loginAs(app, w.users.superAdmin);
});
afterAll(() => db.$disconnect());

type Result = {
  dryRun: boolean;
  errors: { row: number; field: string; message: string }[];
  summary: { users: number; newGroups: string[]; existingGroups: string[] };
  created: { username: string; temporaryPassword: string }[];
};
const run = async (rows: Record<string, string>[], dryRun: boolean) =>
  admin.post("/api/users/import").send({ rows, dryRun });

const good: Record<string, string>[] = [
  {
    username: "Imp.One",
    fullName: "Imp One",
    email: "",
    mobile: "",
    group: "Group A",
    groupIntakeDate: "",
    joinDate: "",
  },
  {
    username: "imp.two",
    fullName: "Imp Two",
    email: "two@example.com",
    group: "Intake Nov",
    groupIntakeDate: "2026-11-01",
    joinDate: "2026-11-10",
  },
  { username: "imp.three", fullName: "Imp Three" },
];

describe("POST /api/users/import", () => {
  it("dry run: reports what would happen and writes nothing", async () => {
    const before = await db.user.count();
    const res = await run(good, true);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      dryRun: true,
      errors: [],
      summary: { users: 3, newGroups: ["Intake Nov"], existingGroups: ["Group A"] },
      created: [],
    });
    expect(await db.user.count()).toBe(before);
    expect(await db.group.findUnique({ where: { name: "Intake Nov" } })).toBeNull();
  });

  it("creates every user, new groups and memberships, with temporary passwords shown once", async () => {
    const res = await run(good, false);
    expect(res.status).toBe(200);
    const body = res.body as Result;
    expect(body.created.map((c) => c.username)).toEqual(["imp.one", "imp.two", "imp.three"]);

    const two = await db.user.findUniqueOrThrow({
      where: { username: "imp.two" },
      include: { memberships: { include: { group: true } } },
    });
    expect(two).toMatchObject({ role: "STUDENT", mustChangePassword: true, email: "two@example.com" });
    expect(two.memberships[0]?.group.name).toBe("Intake Nov");
    expect(two.memberships[0]?.joinDate?.toISOString().slice(0, 10)).toBe("2026-11-10");
    expect(two.memberships[0]?.group.intakeStartDate.toISOString().slice(0, 10)).toBe("2026-11-01");

    // The temporary password works (and forces a change).
    const login = await loginAs(app, { username: "imp.two", password: body.created[1]?.temporaryPassword ?? "" });
    expect(
      ((await login.get("/api/auth/me")).body as { user: { mustChangePassword: boolean } }).user.mustChangePassword,
    ).toBe(true);

    const actions = (
      await db.auditLog.findMany({ where: { action: { in: ["users.created", "groups.created", "users.imported"] } } })
    ).map((a) => a.action);
    expect(actions.filter((a) => a === "users.created")).toHaveLength(3);
    expect(actions).toContain("groups.created");
    expect(actions).toContain("users.imported");
  });

  it("reports every problem with its row and field, and imports nothing", async () => {
    const rows: Record<string, string>[] = [
      { username: "ok.user", fullName: "Ok" },
      { username: "x", fullName: "" }, // too short, missing name
      { username: "student.a", fullName: "Taken" }, // exists
      { username: "OK.USER", fullName: "Duplicate in file" }, // same as row 1 after lowercasing
      { username: "new.group", fullName: "New Group", group: "Brand New" }, // new group without intake date
      { username: "bad.email", fullName: "Bad", email: "nope" },
    ];
    const dry = (await run(rows, true)).body as Result;
    expect(dry.errors).toEqual([
      { row: 2, field: "username", message: "3-50 characters: a-z 0-9 . _ -" },
      { row: 2, field: "fullName", message: "Required" },
      { row: 6, field: "email", message: "Not a valid email" },
    ]);

    // Fix the per-row problems: the cross-row and database checks then report theirs.
    const second = (
      await run(
        rows.filter((_, i) => i !== 1 && i !== 5),
        true,
      )
    ).body as Result;
    expect(second.errors).toEqual([
      { row: 2, field: "username", message: "This username already exists" },
      { row: 3, field: "username", message: "Same username as row 1" },
      { row: 4, field: "groupIntakeDate", message: '"Brand New" is a new group: give its intake date' },
    ]);

    const before = await db.user.count();
    const real = await run(
      rows.filter((_, i) => i !== 1 && i !== 5),
      false,
    );
    expect(real.status).toBe(400);
    expect((real.body as { error: string }).error).toBe("VALIDATION_FAILED");
    expect(await db.user.count()).toBe(before);
  });

  it("refuses inconsistent intake dates for one new group", async () => {
    const res = await run(
      [
        { username: "a.one", fullName: "A", group: "Split", groupIntakeDate: "2026-11-01" },
        { username: "a.two", fullName: "B", group: "Split", groupIntakeDate: "2026-12-01" },
      ],
      true,
    );
    expect((res.body as Result).errors).toEqual([
      { row: 1, field: "groupIntakeDate", message: 'Rows give different intake dates for "Split"' },
    ]);
  });

  it("limits the number of rows per request", async () => {
    const rows = Array.from({ length: 201 }, (_, i) => ({ username: `bulk.${i}`, fullName: `Bulk ${i}` }));
    expect((await run(rows, true)).status).toBe(400);
    expect((await run([], true)).status).toBe(400);
  });
});

describe("GET /api/users/lookup", () => {
  type Hit = { id: string; username: string; fullName: string; role: string };

  it("finds people by name or username, filtered by role, without account details", async () => {
    const hits = (await admin.get("/api/users/lookup?q=student")).body as Hit[];
    expect(hits.map((h) => h.username).sort()).toEqual(["student.a", "student.b"]);
    expect(Object.keys(hits[0] ?? {}).sort()).toEqual(["fullName", "id", "role", "username"]);

    const instructors = (await admin.get("/api/users/lookup?role=INSTRUCTOR")).body as Hit[];
    expect(instructors.every((h) => h.role === "INSTRUCTOR")).toBe(true);
    expect(instructors).toHaveLength(6);
  });

  it("instructors find only students in their reach; deactivated users never appear", async () => {
    const instExamA = await loginAs(app, w.users.instExamA);
    expect(((await instExamA.get("/api/users/lookup")).body as Hit[]).map((h) => h.username)).toEqual(["student.a"]);

    await db.user.update({ where: { id: w.users.student.id }, data: { isActive: false } });
    expect(((await admin.get("/api/users/lookup?q=student")).body as Hit[]).map((h) => h.username)).toEqual([
      "student.b",
    ]);
  });

  it("caps the result size", async () => {
    expect(((await admin.get("/api/users/lookup?limit=2")).body as Hit[]).length).toBe(2);
    expect((await admin.get("/api/users/lookup?limit=500")).status).toBe(400);
  });
});
