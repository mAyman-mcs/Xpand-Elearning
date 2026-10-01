import { useState, type FormEvent } from "react";
import { api, ApiError } from "../api";
import { useAuth } from "../auth";

export function ChangePassword() {
  const { user, setUser, logout } = useAuth();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (next !== confirm) {
      setError("The new passwords do not match.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await api.changePassword(current, next);
      setUser(res.user);
    } catch (err) {
      if (err instanceof ApiError && err.code === "WRONG_CURRENT_PASSWORD") setError("Your current password is incorrect.");
      else if (err instanceof ApiError && err.code === "WEAK_PASSWORD") setError(err.message);
      else setError("Could not change the password.");
    } finally {
      setBusy(false);
    }
  }

  const field = "w-full rounded-lg border border-slate-300 px-4 py-3 outline-none focus:ring-2 focus:ring-teal-500";

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-900 p-4">
      <form onSubmit={submit} className="w-full max-w-md space-y-4 rounded-xl bg-white p-8 shadow-2xl">
        <h1 className="text-xl font-bold text-slate-800">Set a new password</h1>
        <p className="text-sm text-slate-500">
          Welcome, {user?.fullName}. You are using a temporary password; choose your own to continue. It needs at least
          10 characters, with letters and numbers.
        </p>
        {error && (
          <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-medium text-red-700">
            {error}
          </div>
        )}
        <input type="password" placeholder="Current (temporary) password" autoComplete="current-password" className={field} value={current} onChange={(e) => setCurrent(e.target.value)} required />
        <input type="password" placeholder="New password" autoComplete="new-password" className={field} value={next} onChange={(e) => setNext(e.target.value)} required />
        <input type="password" placeholder="Confirm new password" autoComplete="new-password" className={field} value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
        <button disabled={busy} className="w-full rounded-lg bg-teal-600 px-4 py-3 font-bold text-white hover:bg-teal-700 disabled:bg-slate-400">
          {busy ? "Saving…" : "Save password"}
        </button>
        <button type="button" onClick={logout} className="w-full text-sm text-slate-500 hover:text-slate-700">
          Sign out
        </button>
      </form>
    </div>
  );
}
