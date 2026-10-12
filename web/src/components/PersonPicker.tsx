import type { PersonRef, Role } from "@contracts";
import { useState } from "react";
import { useUsers } from "../features/users/queries";
import { useDebounced } from "../lib/forms";
import { TextInput } from "./form";
import { Button, Loading } from "./ui";

interface Props {
  label: string;
  role?: Role;
  selected: PersonRef[];
  onChange: (people: PersonRef[]) => void;
  /** Already chosen elsewhere (e.g. current group members): shown as unavailable. */
  excludeIds?: Set<string>;
  max?: number;
}

/** Search people on the server (within the caller's scope) and pick one or more. */
export function PersonPicker({ label, role, selected, onChange, excludeIds, max }: Props) {
  const [search, setSearch] = useState("");
  const q = useDebounced(search.trim());
  const users = useUsers({ q: q || undefined, role });
  const chosen = new Set(selected.map((p) => p.id));
  const full = max !== undefined && selected.length >= max;

  const toggle = (p: PersonRef) =>
    onChange(chosen.has(p.id) ? selected.filter((s) => s.id !== p.id) : [...selected, p]);

  return (
    <div className="space-y-3">
      <TextInput
        label={label}
        type="search"
        placeholder="Search by name or username"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      {selected.length > 0 && (
        <ul aria-label="Selected" className="flex flex-wrap gap-2">
          {selected.map((p) => (
            <li
              key={p.id}
              className="flex items-center gap-1 rounded-full bg-teal-50 py-1 pr-1 pl-3 text-sm text-teal-800"
            >
              {p.fullName}
              <button
                type="button"
                aria-label={`Remove ${p.fullName}`}
                onClick={() => toggle(p)}
                className="rounded-full px-1.5 text-teal-700 hover:bg-teal-100"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="max-h-64 overflow-y-auto rounded-lg border border-slate-200">
        {users.isPending ? (
          <Loading />
        ) : !users.rows?.length ? (
          <p className="p-3 text-sm text-slate-500">Nobody matches.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {users.rows.map((u) => {
              const taken = excludeIds?.has(u.id) ?? false;
              const isChosen = chosen.has(u.id);
              return (
                <li key={u.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                  <span>
                    <span className="font-medium">{u.fullName}</span>{" "}
                    <span className="font-mono text-xs text-slate-500">{u.username}</span>
                  </span>
                  {taken ? (
                    <span className="text-xs text-slate-400">Already added</span>
                  ) : (
                    <Button
                      size="sm"
                      variant={isChosen ? "primary" : "secondary"}
                      disabled={!isChosen && full}
                      aria-pressed={isChosen}
                      aria-label={`${isChosen ? "Unselect" : "Select"} ${u.fullName}`}
                      onClick={() => toggle({ id: u.id, username: u.username, fullName: u.fullName })}
                    >
                      {isChosen ? "Selected" : "Select"}
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {users.hasNextPage && (
          <div className="p-2 text-center">
            <Button
              size="sm"
              variant="ghost"
              busy={users.isFetchingNextPage}
              onClick={() => void users.fetchNextPage()}
            >
              Show more
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
