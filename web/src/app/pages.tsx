import type { Role } from "@contracts";
import { useEffect } from "react";
import { Link, Navigate, Outlet, isRouteErrorResponse, useRouteError } from "react-router";
import { Loading } from "../components/ui";
import { ApiError, errorMessage } from "../lib/api";
import { hasAnyGrant } from "../lib/permissions";
import { useAuth, usePermissions } from "./auth";

export function usePageTitle(title: string) {
  useEffect(() => {
    document.title = `${title} · Xpand Academy`;
  }, [title]);
}

/** "/" sends each role to its own start page. */
export function HomeRedirect() {
  const { user } = useAuth();
  if (user?.role === "SUPER_ADMIN") return <Navigate to="/admin" replace />;
  if (user?.role === "INSTRUCTOR") return <Navigate to="/exams" replace />;
  return <Navigate to="/student" replace />;
}

export function RequireRole({ roles }: { roles: Role[] }) {
  const { user } = useAuth();
  return user && roles.includes(user.role) ? <Outlet /> : <NoAccess />;
}

/** Super admins, and instructors with at least one active grant. */
export function RequireStaff() {
  const { user } = useAuth();
  const { data: perms, isPending } = usePermissions();
  if (user?.role === "SUPER_ADMIN") return <Outlet />;
  if (user?.role !== "INSTRUCTOR") return <NoAccess />;
  if (isPending) return <Loading />;
  return hasAnyGrant(perms) ? (
    <Outlet />
  ) : (
    <NoAccess message="You have no active access grants. Ask a super admin to grant you access." />
  );
}

function Message({ title, children }: { title: string; children: React.ReactNode }) {
  usePageTitle(title);
  return (
    <div className="mx-auto max-w-lg rounded-xl border border-slate-200 bg-white p-8 text-center shadow-sm">
      <h1 className="text-xl font-bold text-slate-800">{title}</h1>
      <div className="mt-2 text-sm text-slate-500">{children}</div>
      <Link to="/" className="mt-6 inline-block text-sm font-semibold text-teal-700 hover:underline">
        Go to the start page
      </Link>
    </div>
  );
}

export function NoAccess({ message }: { message?: string }) {
  return <Message title="No access">{message ?? "You don't have access to this page."}</Message>;
}

export function NotFound() {
  return <Message title="Page not found">This page doesn't exist, or you don't have access to it.</Message>;
}

/** A page whose main record answered 404 (missing, or outside the caller's scope: the server hides which). */
export function QueryErrorPage({ error }: { error: unknown }) {
  if (error instanceof ApiError && error.status === 404) return <NotFound />;
  if (error instanceof ApiError && error.status === 403) return <NoAccess />;
  return <Message title="Something went wrong">{errorMessage(error)}</Message>;
}

export function RouteError() {
  const error = useRouteError();
  if (isRouteErrorResponse(error) && error.status === 404) return <NotFound />;
  console.error(error);
  return (
    <div className="p-8">
      <Message title="Something went wrong">The page crashed. Reload it; if it keeps happening, report it.</Message>
    </div>
  );
}
