import { describe, expect, it } from "vitest";
import { parseCsv, toCsv } from "./csv.js";

describe("parseCsv", () => {
  it("parses headers, quotes, escaped quotes and CRLF", () => {
    const text =
      String.fromCharCode(0xfeff) + 'username,fullName\r\nahmed,"Tarek, Ahmed ""AT"""\r\n\r\nomar,Omar Nabil\n';
    expect(parseCsv(text)).toEqual([
      { username: "ahmed", fullName: 'Tarek, Ahmed "AT"' },
      { username: "omar", fullName: "Omar Nabil" },
    ]);
  });

  it("round-trips through toCsv", () => {
    const rows = [{ a: 'x,"y"', b: "line\nbreak" }];
    expect(parseCsv(toCsv(rows))).toEqual(rows);
  });
});
