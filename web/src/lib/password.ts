// The server's password rules (server/src/modules/auth/password.ts), shown as a live checklist.
// The server checks again; this is only so people see what is missing while they type.

export interface PasswordCheck {
  label: string;
  ok: boolean;
}

export function passwordChecks(password: string, username: string): PasswordCheck[] {
  return [
    { label: "At least 10 characters", ok: password.length >= 10 && password.length <= 128 },
    { label: "Letters and numbers", ok: /[a-zA-Z]/.test(password) && /[0-9]/.test(password) },
    {
      label: "Doesn't contain your username",
      ok: password.length > 0 && (!username || !password.toLowerCase().includes(username.toLowerCase())),
    },
  ];
}
