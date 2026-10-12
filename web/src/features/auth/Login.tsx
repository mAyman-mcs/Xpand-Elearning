import { useState, type FormEvent } from "react";
import { useAuth } from "../../app/auth";
import { usePageTitle } from "../../app/pages";
import { Button } from "../../components/ui";
import { api, errorMessage } from "../../lib/api";

const field = "w-full rounded-lg border border-slate-300 px-4 py-3 outline-none focus:ring-2 focus:ring-teal-500";

export function Login() {
  usePageTitle("Sign in");
  const { signedIn, sessionExpired } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { user } = await api.auth.login(username, password);
      signedIn(user);
    } catch (err) {
      setError(errorMessage(err, { INVALID_CREDENTIALS: "Invalid username or password." }));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-900 p-4">
      <form onSubmit={(e) => void submit(e)} className="w-full max-w-md space-y-5 rounded-xl bg-white p-8 shadow-2xl">
        <div className="mb-6 text-center">
          <h1 className="mb-2 text-2xl font-bold text-slate-800">Xpand CS Academy</h1>
          <p className="font-mono text-sm text-slate-500">Secure Assessment Portal</p>
        </div>
        {sessionExpired && !error && (
          <div
            role="status"
            className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-center text-sm text-amber-800"
          >
            Your session expired. Sign in again to continue where you were.
          </div>
        )}
        {error && (
          <div
            role="alert"
            className="rounded-lg border border-red-200 bg-red-50 p-3 text-center text-sm font-medium text-red-700"
          >
            {error}
          </div>
        )}
        <label className="block">
          <span className="mb-1 block text-sm font-semibold text-slate-700">Username</span>
          <input
            className={field}
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-semibold text-slate-700">Password</span>
          <input
            type="password"
            className={field}
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>
        <Button type="submit" busy={busy} className="w-full py-3">
          {busy ? "Signing in…" : "Sign in"}
        </Button>
      </form>
    </div>
  );
}
