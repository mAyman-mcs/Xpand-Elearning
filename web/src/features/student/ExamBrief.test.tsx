import type { StudentExamBrief } from "@contracts";
import { screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderWithClient } from "../../test/render";
import { server } from "../../test/server";
import { ExamBrief } from "./ExamBrief";

const brief = (requireFullscreen: boolean): StudentExamBrief => ({
  exam: {
    id: "e1",
    code: "CLOUD-1",
    title: "Cloud Gates",
    durationMinutes: 45,
    questionCount: 10,
    strikeLimit: 3,
    requireFullscreen,
    allowBackNavigation: true,
    isExternal: false,
    intro: null,
    materials: [],
  },
  status: "OPEN",
  progress: "NOT_STARTED",
  opensAt: null,
  closesAt: null,
  reason: "",
  inProgressAttemptId: null,
});

/** The brief page on a device: touch or not, with or without fullscreen. */
function renderBrief({ touch = false, fullscreenEnabled = true, requireFullscreen = true } = {}) {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: touch && query === "(pointer: coarse)" }));
  Object.defineProperty(document, "fullscreenEnabled", { configurable: true, value: fullscreenEnabled });
  const start = vi.fn();
  server.use(
    http.get("/api/student/exams/e1", () => HttpResponse.json(brief(requireFullscreen))),
    http.post("/api/attempts", () => {
      start();
      return HttpResponse.json({ error: { code: "NOT_FOUND", message: "Not found" } }, { status: 404 });
    }),
  );
  const router = createMemoryRouter([{ path: "/student/exams/:id", element: <ExamBrief /> }], {
    initialEntries: ["/student/exams/e1"],
  });
  return { start, ...renderWithClient(<RouterProvider router={router} />) };
}

afterEach(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(document, "fullscreenEnabled");
});

describe("the exam brief on unsupported devices", () => {
  it("lets a computer start", async () => {
    renderBrief();
    expect(await screen.findByRole("button", { name: "Start exam" })).toBeInTheDocument();
  });

  it("doesn't offer Start on a phone or tablet", async () => {
    renderBrief({ touch: true });
    expect(await screen.findByText(/need a laptop or desktop computer/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Start exam" })).not.toBeInTheDocument();
  });

  it("doesn't offer Start when the exam needs fullscreen and the browser has none", async () => {
    renderBrief({ fullscreenEnabled: false });
    expect(await screen.findByText(/can't switch to fullscreen/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Start exam" })).not.toBeInTheDocument();
  });

  it("allows a browser without fullscreen when the exam doesn't need it", async () => {
    renderBrief({ fullscreenEnabled: false, requireFullscreen: false });
    expect(await screen.findByRole("button", { name: "Start exam" })).toBeInTheDocument();
  });

  it("doesn't start the timer when the browser refuses fullscreen", async () => {
    const { user, start } = renderBrief();
    document.documentElement.requestFullscreen = vi.fn().mockRejectedValue(new Error("denied"));
    await user.click(await screen.findByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: "Start exam" }));
    expect(await screen.findByText(/didn't switch to fullscreen/)).toBeInTheDocument();
    expect(start).not.toHaveBeenCalled();
  });
});
