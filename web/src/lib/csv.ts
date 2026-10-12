// CSV in the browser (the same rules as the server's core/lib/csv.ts): files are parsed here, and
// credentials are generated here, so they never travel through any other system.

const BYTE_ORDER_MARK = 0xfeff;

/** RFC 4180: quoted fields, escaped quotes, CRLF, Excel's byte-order mark. Rows keyed by header. */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  const src = text.charCodeAt(0) === BYTE_ORDER_MARK ? text.slice(1) : text;

  for (let i = 0; i < src.length; i++) {
    const c = src.charAt(i);
    if (inQuotes) {
      if (c === '"' && src[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') inQuotes = false;
      else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  const nonEmpty = rows.filter((r) => r.some((f) => f.trim() !== ""));
  const [header, ...body] = nonEmpty;
  if (!header) return [];
  const keys = header.map((h) => h.trim());
  return body.map((r) => Object.fromEntries(keys.map((k, i) => [k, (r[i] ?? "").trim()])));
}

/** Neutralizes spreadsheet formulas (=, +, -, @) so a name can't run code when the file is opened. */
const safe = (v: string) => (/^[=+\-@\t\r]/.test(v) ? `'${v}` : v);

export function toCsv(rows: Record<string, string>[]): string {
  const [first] = rows;
  if (!first) return "";
  const keys = Object.keys(first);
  const esc = (v: string) => {
    const s = safe(v);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [keys.join(","), ...rows.map((r) => keys.map((k) => esc(r[k] ?? "")).join(","))].join("\r\n") + "\r\n";
}

/** Offers text as a file download (generated in the browser; nothing is uploaded). */
export function downloadText(filename: string, text: string, type = "text/csv;charset=utf-8") {
  // The byte-order mark makes Excel read UTF-8 (Arabic names) correctly.
  const blob = new Blob(["﻿", text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
