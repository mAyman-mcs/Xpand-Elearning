import type { ReactNode } from "react";
import { Button, cx, EmptyState, ErrorBanner, Loading } from "./ui";

export interface Column<T> {
  header: string;
  cell: (row: T) => ReactNode;
  className?: string;
}

interface TableProps<T> {
  columns: Column<T>[];
  rows: T[] | undefined;
  /** Unique per row; the index helps when rows can repeat (a student in two chosen groups). */
  rowKey: (row: T, index: number) => string;
  loading?: boolean;
  error?: unknown;
  onRetry?: () => void;
  empty: { title: string; hint?: ReactNode };
  /** "Load more" for cursor-paginated lists (A-D7). */
  more?: { hasMore: boolean; loading: boolean; onMore: () => void };
  caption?: string;
}

/** Every list's four states: loading, error, empty, rows (+ load more). */
export function Table<T>({ columns, rows, rowKey, loading, error, onRetry, empty, more, caption }: TableProps<T>) {
  if (loading && !rows) return <Loading />;
  if (error && !rows) return <ErrorBanner error={error} onRetry={onRetry} />;
  if (!rows?.length) return <EmptyState title={empty.title}>{empty.hint}</EmptyState>;
  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-left text-sm">
          {caption && <caption className="sr-only">{caption}</caption>}
          <thead className="border-b border-slate-200 bg-slate-50 text-xs tracking-wide text-slate-500 uppercase">
            <tr>
              {columns.map((c) => (
                <th key={c.header} scope="col" className={cx("px-4 py-3 font-semibold", c.className)}>
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((row, index) => (
              <tr key={rowKey(row, index)} className="hover:bg-slate-50">
                {columns.map((c) => (
                  <td key={c.header} className={cx("px-4 py-3 align-top", c.className)}>
                    {c.cell(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {more?.hasMore && (
        <div className="text-center">
          <Button variant="secondary" busy={more.loading} onClick={more.onMore}>
            Load more
          </Button>
        </div>
      )}
    </div>
  );
}
