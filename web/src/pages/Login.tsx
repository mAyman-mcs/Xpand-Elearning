import { useState, type FormEvent } from "react";
import { api, ApiError } from "../api";
import { useAuth } from "../auth";

const messages: Record<string, string> = {
  INVALID_CREDENTIALS: "Invalid username or password.",
  ACCOUNT_LOCKED: "Too many failed attempts. Your account is locked for 15 minutes.",
  TOO_MANY_ATTEMPTS: "Too many login attempts from this network. Try again later.",
};

export function Login() {
  const { setUser } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { user } = await api.login(username, password);
      setUser(user);
    } catch (err) {
      setError(err instanceof ApiError ? (messages[err.code] ?? "Login failed.") : "Network error.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-900 p-4">
      <form onSubmit={submit} className="w-full max-w-md space-y-5 rounded-xl bg-white p-8 shadow-2xl">
        <div className="mb-6 text-center">
          <h1 className="mb-2 text-2xl font-bold text-slate-800">Xpand CS Academy</h1>
          <p className="font-mono text-sm text-slate-500">Secure Assessment Portal</p>
        </div>
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
            className="w-full rounded-lg border border-slate-300 px-4 py-3 outline-none focus:ring-2 focus:ring-teal-500"
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
            className="w-full rounded-lg border border-slate-300 px-4 py-3 outline-none focus:ring-2 focus:ring-teal-500"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>
        <button
          disabled={busy}
          className="w-full rounded-lg bg-teal-600 px-4 py-3 font-bold text-white transition-colors hover:bg-teal-700 disabled:bg-slate-400"
        >
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}
