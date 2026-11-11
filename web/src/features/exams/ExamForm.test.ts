import { describe, expect, it } from "vitest";
import { NEW_EXAM, patchOf, SETTINGS, type ExamValues } from "./ExamForm";

const before: ExamValues = { ...NEW_EXAM, code: "CLOUD-1", title: "Cloud", categoryId: "c1", intro: "Old intro" };

describe("the Settings patch", () => {
  it("sends nothing when nothing changed", () => {
    expect(patchOf(before, { ...before })).toEqual({});
  });

  it("sends a changed introduction", () => {
    expect(patchOf(before, { ...before, intro: "The story so far" })).toEqual({ intro: "The story so far" });
  });

  it("sends a cleared introduction as null", () => {
    expect(patchOf(before, { ...before, intro: "   " })).toEqual({ intro: null });
  });

  it("sends the case-hints switch", () => {
    expect(patchOf(before, { ...before, showHints: true })).toEqual({ showHints: true });
  });

  it("covers every editable setting except the code, category and tags", () => {
    // The code can't change; category and tags are sent separately.
    const handledElsewhere = ["code", "categoryId", "tagIds"];
    const editable = Object.keys(NEW_EXAM).filter((k) => !handledElsewhere.includes(k));
    expect([...SETTINGS].sort()).toEqual(editable.sort());
  });
});
