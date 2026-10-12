import { useState, type FormEvent } from "react";
import { useAuth } from "../../app/auth";
import { usePageTitle } from "../../app/pages";
import { FormError, TextInput } from "../../components/form";
import { Button } from "../../components/ui";
import { api, errorMessage } from "../../lib/api";

/** Forced at first login (temporary password), and after an admin reset. */
export function ChangePassword() {
  usePageTitle("Set a new password");
  const { user, signedIn, logout } = useAuth();
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
      const res = await api.auth.changePassword(current, next);
      signedIn(res.user);
    } catch (err) {
      setError(errorMessage(err, { WRONG_CURRENT_PASSWORD: "Your current password is incorrect." }));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-900 p-4">
      <form onSubmit={(e) => void submit(e)} className="w-full max-w-md space-y-4 rounded-xl bg-white p-8 shadow-2xl">
        <h1 className="text-xl font-bold text-slate-800">Set a new password</h1>
        <p className="text-sm text-slate-500">
          Welcome, {user?.fullName}. You are using a temporary password; choose your own to continue. It needs at least
          10 characters, with letters and numbers, and must not contain your username.
        </p>
        <FormError message={error} />
        <TextInput
          label="Current (temporary) password"
          type="password"
          autoComplete="current-password"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          required
        />
        <TextInput
          label="New password"
          type="password"
          autoComplete="new-password"
          value={next}
          onChange={(e) => setNext(e.target.value)}
          required
        />
        <TextInput
          label="Confirm new password"
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          required
        />
        <Button type="submit" busy={busy} className="w-full py-3">
          {busy ? "Saving…" : "Save password"}
        </Button>
        <Button variant="ghost" onClick={() => void logout()} className="w-full">
          Sign out
        </Button>
      </form>
    </div>
  );
}
