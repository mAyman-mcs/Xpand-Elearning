import type { ImportResult } from "@contracts";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, type ChangeEvent } from "react";
import { useNavigate } from "react-router";
import { usePageTitle } from "../../app/pages";
import { Dialog } from "../../components/Dialog";
import { FormError } from "../../components/form";
import { Table } from "../../components/Table";
import { Badge, Button, ButtonLink, Card, PageHeader } from "../../components/ui";
import { api, errorMessage } from "../../lib/api";
import { downloadText, parseCsv, toCsv } from "../../lib/csv";
import { qk } from "../../lib/query";

const COLUMNS = ["username", "fullName", "email", "mobile", "group", "groupIntakeDate", "joinDate"] as const;
const MAX_ROWS = 200;
const TEMPLATE = `${COLUMNS.join(",")}\r\nsara.ali,Sara Ali,sara@example.com,+20 100 000 0000,Intake Nov 2026,2026-11-01,\r\n`;

type Credentials = ImportResult["created"];

/** Upload → check (dry run) → import → credentials once (docs/ADMIN_DASHBOARD_PLAN.md A3). */
export function ImportUsers() {
  usePageTitle("Import users");
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [fileName, setFileName] = useState<string | null>(null);
  const [rows, setRows] = useState<Record<string, string>[] | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [check, setCheck] = useState<ImportResult | null>(null);
  const [credentials, setCredentials] = useState<Credentials | null>(null);

  const dryRun = useMutation({
    mutationFn: (r: Record<string, string>[]) => api.users.import(r, true),
    onSuccess: setCheck,
  });
  const doImport = useMutation({
    mutationFn: (r: Record<string, string>[]) => api.users.import(r, false),
    onSuccess: async (res) => {
      setCredentials(res.created);
      await queryClient.invalidateQueries({ queryKey: qk.users });
      await queryClient.invalidateQueries({ queryKey: qk.groups });
    },
  });

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    setCheck(null);
    setRows(null);
    setFileError(null);
    dryRun.reset();
    doImport.reset();
    if (!file) return;
    setFileName(file.name);
    const parsed = parseCsv(await file.text());
    const header = Object.keys(parsed[0] ?? {});
    if (!parsed.length) setFileError("The file has no data rows (the first line must be the column names).");
    else if (!header.includes("username") || !header.includes("fullName"))
      setFileError(
        `The first line must name the columns; "username" and "fullName" are required. Found: ${header.join(", ")}.`,
      );
    else if (parsed.length > MAX_ROWS)
      setFileError(`The file has ${parsed.length} rows; import at most ${MAX_ROWS} at a time.`);
    else {
      setRows(parsed);
      dryRun.mutate(parsed);
    }
  }

  const ready = check && !check.errors.length && rows;

  return (
    <>
      <PageHeader
        title="Import users"
        description="Create many students at once from a CSV file. Nothing is created until the whole file is valid."
        actions={
          <Button variant="secondary" onClick={() => downloadText("students-template.csv", TEMPLATE)}>
            Download template
          </Button>
        }
      />
      <div className="space-y-6">
        <Card title="1. Choose the file">
          <p className="mb-3 text-sm text-slate-600">
            Columns: <code className="text-xs">{COLUMNS.join(", ")}</code>. Only{" "}
            <code className="text-xs">username</code> and <code className="text-xs">fullName</code> are required. A
            group that doesn&apos;t exist yet is created with its <code className="text-xs">groupIntakeDate</code>.
            Dates are YYYY-MM-DD. Up to {MAX_ROWS} rows.
          </p>
          <label className="block text-sm font-semibold text-slate-700">
            CSV file
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => void onFile(e)}
              className="mt-1 block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-teal-50 file:px-4 file:py-2 file:font-semibold file:text-teal-700"
            />
          </label>
          <div className="mt-3">
            <FormError message={fileError ?? (dryRun.error ? errorMessage(dryRun.error) : null)} />
          </div>
        </Card>

        {rows && (
          <Card title={`2. Check ${fileName ?? "the file"}`}>
            {dryRun.isPending && <p className="text-sm text-slate-500">Checking {rows.length} rows…</p>}
            {check && check.errors.length > 0 && (
              <div className="space-y-3">
                <p role="alert" className="text-sm font-semibold text-red-700">
                  {check.errors.length} problem{check.errors.length === 1 ? "" : "s"} found. Fix the file and choose it
                  again; nothing has been created.
                </p>
                <Table
                  caption="Problems"
                  columns={[
                    { header: "Line", cell: (e) => e.row + 1 },
                    { header: "Username", cell: (e) => rows[e.row - 1]?.username ?? "" },
                    { header: "Column", cell: (e) => <code className="text-xs">{e.field}</code> },
                    { header: "Problem", cell: (e) => e.message },
                  ]}
                  rows={check.errors}
                  rowKey={(e) => `${e.row}-${e.field}`}
                  empty={{ title: "" }}
                />
              </div>
            )}
            {ready && (
              <div className="space-y-3 text-sm">
                <p>
                  <Badge tone="green">Valid</Badge> {check.summary.users} student{check.summary.users === 1 ? "" : "s"}{" "}
                  will be created.
                </p>
                {check.summary.newGroups.length > 0 && <p>New groups: {check.summary.newGroups.join(", ")}.</p>}
                {check.summary.existingGroups.length > 0 && (
                  <p>Added to existing groups: {check.summary.existingGroups.join(", ")}.</p>
                )}
                <FormError message={doImport.error ? errorMessage(doImport.error) : null} />
                <Button busy={doImport.isPending} onClick={() => doImport.mutate(rows)}>
                  {doImport.isPending ? "Importing… (about ¼ s per student)" : `Import ${check.summary.users} students`}
                </Button>
              </div>
            )}
          </Card>
        )}
      </div>

      <Dialog
        open={credentials !== null}
        onOpenChange={() => undefined}
        title={`${credentials?.length ?? 0} students imported`}
        description="These temporary passwords are shown only once. Download them now and hand them out; each student must change theirs at first login."
        wide
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() =>
                downloadText(`credentials-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(credentials ?? []))
              }
            >
              Download credentials (CSV)
            </Button>
            <Button
              onClick={() => {
                setCredentials(null);
                void navigate("/admin/users");
              }}
            >
              I have saved them
            </Button>
          </>
        }
      >
        <div className="max-h-80 overflow-y-auto">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Credentials</caption>
            <thead className="text-xs text-slate-500 uppercase">
              <tr>
                <th className="py-1">Name</th>
                <th className="py-1">Username</th>
                <th className="py-1">Temporary password</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {credentials?.map((c) => (
                <tr key={c.username}>
                  <td className="py-1">{c.fullName}</td>
                  <td className="py-1 font-mono">{c.username}</td>
                  <td className="py-1 font-mono font-bold" data-testid="secret-value">
                    {c.temporaryPassword}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Dialog>
      {!rows && !fileError && (
        <p className="mt-6 text-sm text-slate-500">
          Prefer single accounts?{" "}
          <ButtonLink to="/admin/users/new" variant="ghost" size="sm">
            Create one user
          </ButtonLink>
        </p>
      )}
    </>
  );
}
