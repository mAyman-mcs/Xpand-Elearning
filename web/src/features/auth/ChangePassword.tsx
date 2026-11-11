import { useState, type FormEvent } from "react";
import { useAuth } from "../../app/auth";
import { usePageTitle } from "../../app/pages";
import { FormError, TextInput } from "../../components/form";
import { useToast } from "../../components/Toast";
import { Button, Card, cx, PageHeader } from "../../components/ui";
import { api, errorMessage } from "../../lib/api";
import { passwordChecks } from "../../lib/password";

/**
 * "forced": at first login (temporary password) and after an admin reset, before anything else.
 * "voluntary": /account, inside the app, whenever the user wants a new password.
 */
export function ChangePassword({ mode = "forced" }: { mode?: "forced" | "voluntary" }) {
  const forced = mode === "forced";
  usePageTitle(forced ? "Set a new password" : "Change password");
  const { user, signedIn, logout } = useAuth();
  const toast = useToast();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const checks = passwordChecks(next, user?.username ?? "");
  const mismatch = confirm.length > 0 && next !== confirm;

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
      if (!forced) {
        setCurrent("");
        setNext("");
        setConfirm("");
        toast("Password changed");
      }
    } catch (err) {
      setError(errorMessage(err, { WRONG_CURRENT_PASSWORD: "Your current password is incorrect." }));
    } finally {
      setBusy(false);
    }
  }

  const form = (
    <form onSubmit={(e) => void submit(e)} className="space-y-4">
      <FormError message={error} />
      <TextInput
        label={forced ? "Current (temporary) password" : "Current password"}
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
        // The rules as a live checklist, read with the field.
        hint={
          <span className="mt-1 block space-y-1">
            {checks.map((c) => (
              <span
                key={c.label}
                className={cx("flex items-center gap-1.5", c.ok ? "text-emerald-700" : "text-slate-600")}
              >
                <span aria-hidden="true" className="inline-block w-3 text-center font-bold">
                  {c.ok ? "✓" : "·"}
                </span>
                {c.label}
                <span className="sr-only">{c.ok ? ": met." : ": not met yet."}</span>
              </span>
            ))}
          </span>
        }
      />
      <TextInput
        label="Confirm new password"
        type="password"
        autoComplete="new-password"
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
        error={mismatch ? "Doesn't match the new password yet." : undefined}
        required
      />
      <Button type="submit" busy={busy} className={forced ? "w-full py-3" : undefined}>
        {busy ? "Saving…" : forced ? "Save password" : "Change password"}
      </Button>
      {forced && (
        <Button variant="ghost" onClick={() => void logout()} className="w-full">
          Sign out
        </Button>
      )}
    </form>
  );

  if (!forced)
    return (
      <div className="max-w-lg">
        <PageHeader title="Change password" description={`Signed in as ${user?.username ?? ""}.`} />
        <Card>{form}</Card>
      </div>
    );

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-slate-900 to-brand-900 p-4">
      <div className="w-full max-w-md space-y-4 rounded-xl bg-white p-8 shadow-2xl">
        <h1 className="text-xl font-bold text-slate-800">Set a new password</h1>
        <p className="text-sm text-slate-600">
          Welcome, {user?.fullName}. You are using a temporary password; choose your own to continue.
        </p>
        {form}
      </div>
    </div>
  );
}
