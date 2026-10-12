import { describe, expect, it } from "vitest";
import { parseCsv, toCsv } from "./csv";

describe("parseCsv", () => {
  it("reads rows keyed by the header, trimming cells and skipping blank lines", () => {
    expect(parseCsv("username,fullName\r\n a.one , A One \r\n\r\nb.two,B Two\n")).toEqual([
      { username: "a.one", fullName: "A One" },
      { username: "b.two", fullName: "B Two" },
    ]);
  });

  it("handles quotes, embedded commas and newlines, and Excel's byte-order mark", () => {
    const text = String.fromCharCode(0xfeff) + 'name,note\n"Doe, Jane","said ""hi""\nthen left"\n';
    expect(parseCsv(text)).toEqual([{ name: "Doe, Jane", note: 'said "hi"\nthen left' }]);
  });

  it("fills missing trailing cells with empty strings", () => {
    expect(parseCsv("a,b,c\n1\n")).toEqual([{ a: "1", b: "", c: "" }]);
  });

  it("returns nothing for an empty file", () => {
    expect(parseCsv("")).toEqual([]);
    expect(parseCsv("\n\n")).toEqual([]);
  });
});

describe("toCsv", () => {
  it("quotes when needed and round-trips through parseCsv", () => {
    const rows = [{ username: "a.one", fullName: 'Jane "J" Doe, Jr.' }];
    expect(parseCsv(toCsv(rows))).toEqual(rows);
  });

  it("neutralizes spreadsheet formulas", () => {
    expect(toCsv([{ name: "=HYPERLINK(1)" }])).toContain("'=HYPERLINK(1)");
    expect(toCsv([{ name: "-2" }])).toContain("'-2");
  });
});
