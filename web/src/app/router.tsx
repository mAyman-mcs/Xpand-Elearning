import { createBrowserRouter, Outlet } from "react-router";
import { Loading } from "../components/ui";
import { AuditLog } from "../features/audit/AuditLog";
import { ChangePassword } from "../features/auth/ChangePassword";
import { Login } from "../features/auth/Login";
import { Dashboard } from "../features/dashboard/Dashboard";
import { GroupDetail } from "../features/groups/GroupDetail";
import { GroupsList } from "../features/groups/GroupsList";
import { StudentHome } from "../features/student/StudentHome";
import { NewUser } from "../features/users/NewUser";
import { UserDetail } from "../features/users/UserDetail";
import { UsersList } from "../features/users/UsersList";
import { useAuth } from "./auth";
import { Layout } from "./Layout";
import { HomeRedirect, NotFound, RequireRole, RequireStaff, RouteError } from "./pages";

/** Signed out → Login (on the same URL, so the user lands where they were); forced change → ChangePassword. */
function Root() {
  const { user, loading } = useAuth();
  if (loading) return <Loading />;
  if (!user) return <Login />;
  if (user.mustChangePassword) return <ChangePassword />;
  return <Outlet />;
}

export const router = createBrowserRouter([
  {
    element: <Root />,
    errorElement: <RouteError />,
    children: [
      {
        element: <Layout />,
        children: [
          { index: true, element: <HomeRedirect /> },
          {
            path: "admin",
            element: <RequireRole roles={["SUPER_ADMIN"]} />,
            children: [
              { index: true, element: <Dashboard /> },
              { path: "users", element: <UsersList mode="admin" /> },
              { path: "users/new", element: <NewUser /> },
              { path: "users/:id", element: <UserDetail mode="admin" /> },
              { path: "groups", element: <GroupsList /> },
              { path: "groups/:id", element: <GroupDetail /> },
              { path: "audit", element: <AuditLog /> },
            ],
          },
          {
            element: <RequireStaff />,
            children: [
              { path: "students", element: <UsersList mode="instructor" /> },
              { path: "students/:id", element: <UserDetail mode="instructor" /> },
            ],
          },
          {
            path: "student",
            element: <RequireRole roles={["STUDENT"]} />,
            children: [{ index: true, element: <StudentHome /> }],
          },
          { path: "*", element: <NotFound /> },
        ],
      },
    ],
  },
]);
