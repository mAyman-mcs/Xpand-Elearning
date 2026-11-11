import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderWithClient } from "../../test/render";
import { CaseEditor } from "./CaseEditor";

const open = () => {
  const onClose = vi.fn();
  const view = renderWithClient(<CaseEditor examId="e1" onClose={onClose} onSaved={async () => undefined} />);
  return { onClose, ...view };
};

describe("closing an editor with unsaved changes", () => {
  it("closes at once when nothing was typed", async () => {
    const { user, onClose } = open();
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("asks first after typing, and Keep editing keeps the text", async () => {
    const { user, onClose } = open();
    await user.type(screen.getByRole("textbox", { name: /title/i }), "Phishing at the front desk");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(await screen.findByText("Discard your changes?")).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("textbox", { name: /title/i })).toHaveValue("Phishing at the front desk");
  });

  it("closes after Discard", async () => {
    const { user, onClose } = open();
    await user.type(screen.getByRole("textbox", { name: /title/i }), "x");
    await user.keyboard("{Escape}");
    await user.click(await screen.findByRole("button", { name: "Discard" }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
