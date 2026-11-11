import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider, useLocation } from "react-router";
import { describe, expect, it } from "vitest";
import { useUrlFilters } from "./forms";

function Filters() {
  const filters = useUrlFilters({ role: "", show: "all" });
  const location = useLocation();
  return (
    <>
      <p data-testid="url">{location.search}</p>
      <p data-testid="values">{JSON.stringify(filters.values)}</p>
      <p data-testid="active">{String(filters.active)}</p>
      <button onClick={() => filters.set({ role: "STUDENT" })}>student</button>
      <button onClick={() => filters.set({ show: "all" })}>default</button>
      <button onClick={filters.clear}>clear</button>
    </>
  );
}

const renderAt = (url: string) => {
  const router = createMemoryRouter([{ path: "/", element: <Filters /> }], { initialEntries: [url] });
  render(<RouterProvider router={router} />);
  return router;
};

describe("filters kept in the URL", () => {
  it("reads values from the URL, with defaults for the rest", () => {
    renderAt("/?role=INSTRUCTOR&other=kept");
    expect(screen.getByTestId("values")).toHaveTextContent('{"role":"INSTRUCTOR","show":"all"}');
    expect(screen.getByTestId("active")).toHaveTextContent("true");
  });

  it("writes changes to the URL without adding history, and leaves defaults out", async () => {
    const router = renderAt("/?other=kept");
    const before = router.state.historyAction;
    await userEvent.click(screen.getByRole("button", { name: "student" }));
    expect(screen.getByTestId("url")).toHaveTextContent("?other=kept&role=STUDENT");
    expect(router.state.historyAction).toBe("REPLACE");
    expect(before).toBe("POP");

    await userEvent.click(screen.getByRole("button", { name: "default" }));
    expect(screen.getByTestId("url")).not.toHaveTextContent("show=");
  });

  it("clears only its own filters", async () => {
    renderAt("/?role=STUDENT&show=awaiting-grading&other=kept");
    await userEvent.click(screen.getByRole("button", { name: "clear" }));
    expect(screen.getByTestId("url")).toHaveTextContent("?other=kept");
    expect(screen.getByTestId("active")).toHaveTextContent("false");
  });
});
