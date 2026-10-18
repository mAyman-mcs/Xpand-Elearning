import type { Grant } from "@contracts";
import { screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { describe, expect, it, vi } from "vitest";
import { server } from "../../test/server";
import { renderWithClient } from "../../test/render";
import { draftProblems, GrantEditor, toScope } from "./GrantEditor";

const names = {
  exams: new Map([["e1", "Cloud Gates"]]),
  categories: new Map([["c1", "Cloud"]]),
  tags: new Map([["t1", "soc"]]),
  groups: new Map([["g1", "Intake July"]]),
};

const base = {
  permissions: [] as Grant["permissions"],
  examMode: "some" as const,
  examIds: [] as string[],
  categoryIds: [] as string[],
  tagIds: [] as string[],
  groupMode: "some" as const,
  groupIds: [] as string[],
  expires: "",
};

describe("grant draft rules", () => {
  it("lists what's missing before anything is sent", () => {
    expect(draftProblems(base, "2026-10-12")).toEqual([
      "Choose at least one permission.",
      "Choose the exams: all exams, or at least one category, tag or exam.",
      "Choose the students: every group, or at least one group.",
    ]);
    expect(
      draftProblems(
        { ...base, permissions: ["EXAM_EDIT"], categoryIds: ["c1"], groupIds: ["g1"], expires: "2026-10-11" },
        "2026-10-12",
      ),
    ).toEqual(["The expiry date is in the past."]);
  });

  it("'all' modes clear the lists; the expiry is the end of that Cairo day", () => {
    expect(
      toScope({
        ...base,
        permissions: ["EXAM_EDIT"],
        examMode: "all",
        examIds: ["e1"],
        groupMode: "all",
        groupIds: ["g1"],
        expires: "2026-12-31",
      }),
    ).toEqual({
      permissions: ["EXAM_EDIT"],
      allExams: true,
      examIds: [],
      categoryIds: [],
      tagIds: [],
      allGroups: true,
      groupIds: [],
      studentsWhoSubmitted: false,
      expiresAt: "2026-12-31T21:59:59.999Z", // 23:59:59.999 Cairo (UTC+2 in winter)
    });
  });
});

describe("tag grants for students who submitted", () => {
  it("send the tags and the student mode; no groups", () => {
    expect(
      toScope({ ...base, permissions: ["RESULTS_VIEW"], tagIds: ["t1"], groupMode: "submitted", groupIds: ["g1"] }),
    ).toEqual({
      permissions: ["RESULTS_VIEW"],
      allExams: false,
      examIds: [],
      categoryIds: [],
      tagIds: ["t1"],
      allGroups: false,
      groupIds: [],
      studentsWhoSubmitted: true,
      expiresAt: null,
    });
    expect(
      draftProblems({ ...base, permissions: ["RESULTS_VIEW"], tagIds: ["t1"], groupMode: "submitted" }, "2026-10-12"),
    ).toEqual([]);
  });
});

describe("<GrantEditor>", () => {
  function mockCatalog() {
    server.use(
      http.get("/api/catalog/exams", () =>
        HttpResponse.json({
          items: [
            { id: "e1", code: "CLOUD-1", title: "Cloud Gates", category: { id: "c1", name: "Cloud", slug: "cloud" } },
          ],
          nextCursor: null,
          total: 1,
        }),
      ),
      http.get("/api/catalog/categories", () =>
        HttpResponse.json([{ id: "c1", name: "Cloud", slug: "cloud", position: 0, archived: false }]),
      ),
      http.get("/api/catalog/tags", () =>
        HttpResponse.json([{ id: "t1", name: "soc", slug: "soc", examCount: 1, grantCount: 0 }]),
      ),
      http.get("/api/groups", () =>
        HttpResponse.json([{ id: "g1", name: "Intake July", intakeStartDate: "2026-07-01", memberCount: 3 }]),
      ),
    );
  }

  it("builds the grant step by step, previews it as a sentence, and sends exactly that", async () => {
    mockCatalog();
    let sent: unknown = null;
    server.use(
      http.post("/api/rbac/grants", async ({ request }) => {
        sent = await request.json();
        return HttpResponse.json({ id: "new" }, { status: 201 });
      }),
    );
    const onSaved = vi.fn(() => Promise.resolve());
    const onClose = vi.fn();
    const { user } = renderWithClient(
      <GrantEditor
        open
        onClose={onClose}
        instructor={{ id: "i1", fullName: "Ivan" }}
        names={names}
        onSaved={onSaved}
      />,
    );

    const save = screen.getByRole("button", { name: "Grant access" });
    expect(save).toBeDisabled();
    expect(screen.getByText("Choose at least one permission.")).toBeInTheDocument();

    await user.click(screen.getByRole("checkbox", { name: "Assign exams" }));
    await user.click(screen.getByRole("checkbox", { name: "View results" }));
    await user.click(await screen.findByRole("checkbox", { name: "Cloud" }));
    await user.click(await screen.findByRole("checkbox", { name: "Intake July" }));

    expect(screen.getByTestId("grant-preview")).toHaveTextContent(
      "Can assign exams and view results for exams in Cloud, for students in Intake July.",
    );
    expect(save).toBeEnabled();
    await user.click(save);

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(sent).toEqual({
      userId: "i1",
      permissions: ["EXAM_ASSIGN", "RESULTS_VIEW"],
      allExams: false,
      examIds: [],
      categoryIds: ["c1"],
      tagIds: [],
      allGroups: false,
      groupIds: ["g1"],
      studentsWhoSubmitted: false,
      expiresAt: null,
    });
    expect(onClose).toHaveBeenCalled();
  });

  it("edits an existing grant with PATCH and shows the server's refusal", async () => {
    mockCatalog();
    server.use(
      http.patch("/api/rbac/grants/g-1", () =>
        HttpResponse.json(
          { error: "VALIDATION_FAILED", message: "Exam scope: choose all exams or list some, not both" },
          { status: 400 },
        ),
      ),
    );
    const grant: Grant = {
      id: "g-1",
      userId: "i1",
      user: { username: "ivan", fullName: "Ivan" },
      permissions: ["EXAM_EDIT"],
      allExams: true,
      examIds: [],
      categoryIds: [],
      tagIds: [],
      allGroups: true,
      groupIds: [],
      studentsWhoSubmitted: false,
      expiresAt: null,
      active: true,
      createdAt: "2026-10-01T00:00:00.000Z",
      createdById: null,
    };
    const { user } = renderWithClient(
      <GrantEditor
        open
        onClose={vi.fn()}
        instructor={{ id: "i1", fullName: "Ivan" }}
        grant={grant}
        names={names}
        onSaved={vi.fn()}
      />,
    );
    expect(screen.getByRole("radio", { name: "All exams (including future ones)" })).toBeChecked();
    expect(screen.getByTestId("grant-preview")).toHaveTextContent("for all exams, for students in every group.");
    await user.click(screen.getByRole("button", { name: "Save access" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Exam scope: choose all exams or list some, not both");
  });
});
