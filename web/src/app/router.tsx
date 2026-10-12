import { createBrowserRouter, Outlet } from "react-router";
import { Loading } from "../components/ui";
import { ChangePassword } from "../features/auth/ChangePassword";
import { Login } from "../features/auth/Login";
import { Dashboard } from "../features/dashboard/Dashboard";
import { StudentHome } from "../features/student/StudentHome";
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
            children: [{ index: true, element: <Dashboard /> }],
          },
          {
            element: <RequireStaff />,
            children: [],
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
