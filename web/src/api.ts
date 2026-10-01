export type Role = "SUPER_ADMIN" | "INSTRUCTOR" | "STUDENT";

export interface User {
  id: string;
  username: string;
  fullName: string;
  email: string | null;
  mobile: string | null;
  role: Role;
  mustChangePassword: boolean;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message?: string,
  ) {
    super(message ?? code);
  }
}

async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${url}`, {
    method,
    credentials: "same-origin",
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error ?? "ERROR", data.message);
  return data as T;
}

export const api = {
  me: () => call<{ user: User }>("GET", "/auth/me"),
  login: (username: string, password: string) => call<{ user: User }>("POST", "/auth/login", { username, password }),
  logout: () => call<void>("POST", "/auth/logout", {}),
  changePassword: (currentPassword: string, newPassword: string) =>
    call<{ user: User }>("POST", "/auth/change-password", { currentPassword, newPassword }),
};
