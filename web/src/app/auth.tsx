import type { SessionUser } from "@contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api, ApiError, setSessionEndedHandler } from "../lib/api";
import { qk } from "../lib/query";

interface AuthState {
  user: SessionUser | null;
  loading: boolean;
  /** True after the server ended the session (idle or max age), until the next login. */
  sessionExpired: boolean;
  signedIn: (user: SessionUser) => void;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [sessionExpired, setSessionExpired] = useState(false);

  useEffect(() => {
    api.auth
      .me()
      .then((r) => setUser(r.user))
      .catch((e: unknown) => {
        if (!(e instanceof ApiError && e.status === 401)) console.error(e);
      })
      .finally(() => setLoading(false));
  }, []);

  // Any 401 on a later request means the session is gone: show Login on the same URL, so the
  // user returns to where they were after signing in again.
  useEffect(() => {
    setSessionEndedHandler(() => {
      setUser((current) => {
        if (current) setSessionExpired(true);
        return null;
      });
      queryClient.clear();
    });
    return () => setSessionEndedHandler(null);
  }, [queryClient]);

  const signedIn = useCallback(
    (next: SessionUser) => {
      // Never show one user's cached data to the next one.
      queryClient.clear();
      setSessionExpired(false);
      setUser(next);
    },
    [queryClient],
  );

  const logout = useCallback(async () => {
    await api.auth.logout().catch(() => undefined);
    queryClient.clear();
    setSessionExpired(false);
    setUser(null);
  }, [queryClient]);

  return (
    <AuthContext.Provider value={{ user, loading, sessionExpired, signedIn, logout }}>{children}</AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}

/** The caller's role and active grants (menus and buttons only; the server decides). */
export function usePermissions() {
  const { user } = useAuth();
  return useQuery({
    queryKey: qk.permissions,
    queryFn: api.me.permissions,
    enabled: !!user && !user.mustChangePassword,
  });
}
