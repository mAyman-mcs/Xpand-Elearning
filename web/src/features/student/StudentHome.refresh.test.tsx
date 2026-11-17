import type { StudentExamRow } from "@contracts";
import { focusManager } from "@tanstack/react-query";
import { act, screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import { AuthProvider } from "../../app/auth";
import { qk } from "../../lib/query";
import { renderWithClient } from "../../test/render";
import { server } from "../../test/server";
import { StudentHome } from "./StudentHome";

const row: StudentExamRow = {
  exam: {
    id: "e1",
    code: "DEMO-1",
    title: "Demo Exam 1",
    category: { id: "c1", name: "Demo", slug: "demo" },
    tags: [],
    durationMinutes: 20,
    isExternal: false,
    scoringMode: "AUTO",
    passMark: 50,
    materials: [],
  },
  status: "OPEN",
  progress: "NOT_STARTED",
  opensAt: null,
  closesAt: null,
  reason: "",
  resultsReleased: false,
  result: null,
};

afterEach(() => focusManager.setFocused(undefined));

describe("My exams picks up new assignments", () => {
  it("asks the server again when the student comes back to the tab", async () => {
    let rows: StudentExamRow[] = [];
    server.use(
      http.get("/api/auth/me", () =>
        HttpResponse.json({
          user: {
            id: "s1",
            username: "sara.student",
            fullName: "Sara Student",
            email: null,
            mobile: null,
            role: "STUDENT",
            mustChangePassword: false,
          },
        }),
      ),
      http.get("/api/student/exams", () => HttpResponse.json(rows)),
    );
    const router = createMemoryRouter([{ path: "/student", element: <StudentHome /> }], {
      initialEntries: ["/student"],
    });
    const { client } = renderWithClient(
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>,
    );
    expect(await screen.findByText("No exams yet")).toBeInTheDocument();

    // Staff assign an exam meanwhile; the cached list is older than its stale time.
    rows = [row];
    client
      .getQueryCache()
      .find({ queryKey: qk.studentExams })
      ?.setState({ dataUpdatedAt: Date.now() - 60_000 });
    act(() => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
    });
    expect(await screen.findByText("Demo Exam 1")).toBeInTheDocument();
  });
});
