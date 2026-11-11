import { createBrowserRouter, Navigate, Outlet, useParams } from "react-router";
import { Loading } from "../components/ui";
import { BulkAssign } from "../features/assignments/BulkAssign";
import { WhoAndWhen } from "../features/assignments/WhoAndWhen";
import { AuditLog } from "../features/audit/AuditLog";
import { CatalogPage } from "../features/catalog/CatalogPage";
import { ExamMaterials } from "../features/content/ExamMaterials";
import { ExamQuestions } from "../features/content/ExamQuestions";
import { ExamLayout } from "../features/exams/ExamLayout";
import { ExamSettings } from "../features/exams/ExamSettings";
import { ExamsList } from "../features/exams/ExamsList";
import { NewExam } from "../features/exams/NewExam";
import { ChangePassword } from "../features/auth/ChangePassword";
import { Login } from "../features/auth/Login";
import { Dashboard } from "../features/dashboard/Dashboard";
import { InstructorDashboard } from "../features/dashboard/InstructorDashboard";
import { SubmissionPreview } from "../features/submissions/SubmissionPreview";
import { Submissions } from "../features/submissions/Submissions";
import { GradeAttempt } from "../features/grading/GradeAttempt";
import { ExamResults } from "../features/grading/ExamResults";
import { GroupDetail } from "../features/groups/GroupDetail";
import { GroupsList } from "../features/groups/GroupsList";
import { ExamDone } from "../features/session/ExamDone";
import { ExamSession } from "../features/session/ExamSession";
import { ExamBrief } from "../features/student/ExamBrief";
import { StudentHome } from "../features/student/StudentHome";
import { ImportUsers } from "../features/users/ImportUsers";
import { NewUser } from "../features/users/NewUser";
import { UserDetail } from "../features/users/UserDetail";
import { UsersList } from "../features/users/UsersList";
import { useAuth } from "./auth";
import { Layout } from "./Layout";
import { HomeRedirect, NotFound, RequireRole, RequireStaff, RouteError } from "./pages";

/** Signed out → Login (on the same URL, so the user lands where they were); forced change → ChangePassword. */
/** Old instructor links (/admin/instructors/:id) open the user page, where access now lives. */
function ToUser() {
  const { id = "" } = useParams();
  return <Navigate to={`/admin/users/${id}`} replace />;
}

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
          // Every role: change your own password.
          { path: "account", element: <ChangePassword mode="voluntary" /> },
          {
            path: "admin",
            element: <RequireRole roles={["SUPER_ADMIN"]} />,
            children: [
              { index: true, element: <Dashboard /> },
              { path: "users", element: <UsersList mode="admin" /> },
              { path: "users/new", element: <NewUser /> },
              { path: "users/import", element: <ImportUsers /> },
              { path: "users/:id", element: <UserDetail mode="admin" /> },
              { path: "groups", element: <GroupsList /> },
              { path: "groups/:id", element: <GroupDetail /> },
              { path: "audit", element: <AuditLog /> },
              // Instructors and their access now live under Users.
              { path: "instructors", element: <Navigate to="/admin/users?role=INSTRUCTOR" replace /> },
              { path: "instructors/:id", element: <ToUser /> },
              { path: "catalog", element: <CatalogPage /> },
            ],
          },
          // An instructor's own dashboard: never behind a grant (it shows only what their grants reach).
          {
            path: "instructor",
            element: <RequireRole roles={["INSTRUCTOR"]} />,
            children: [{ index: true, element: <InstructorDashboard /> }],
          },
          // Submitted exams: every staff member; the server filters the list to their scope.
          {
            path: "submissions",
            element: <RequireRole roles={["SUPER_ADMIN", "INSTRUCTOR"]} />,
            children: [
              { index: true, element: <Submissions /> },
              { path: ":attemptId", element: <SubmissionPreview /> },
            ],
          },
          {
            element: <RequireStaff />,
            children: [
              { path: "students", element: <UsersList mode="instructor" /> },
              { path: "exams", element: <ExamsList /> },
              { path: "exams/new", element: <NewExam /> },
              { path: "assignments/new", element: <BulkAssign /> },
              {
                path: "exams/:id",
                element: <ExamLayout />,
                children: [
                  { index: true, element: <ExamSettings /> },
                  { path: "questions", element: <ExamQuestions /> },
                  { path: "materials", element: <ExamMaterials /> },
                  { path: "access", element: <WhoAndWhen /> },
                  // The three tabs it replaced: old links and bookmarks land on the matching section.
                  { path: "assignments", element: <Navigate to="../access#assignments" replace /> },
                  { path: "overrides", element: <Navigate to="../access#overrides" replace /> },
                  { path: "availability", element: <Navigate to="../access" replace /> },
                  { path: "results", element: <ExamResults /> },
                  { path: "grading", element: <Navigate to="../results" replace /> },
                ],
              },
              { path: "grading/:attemptId", element: <GradeAttempt /> },
              { path: "students/:id", element: <UserDetail mode="instructor" /> },
            ],
          },
          {
            path: "student",
            element: <RequireRole roles={["STUDENT"]} />,
            children: [
              { index: true, element: <StudentHome /> },
              { path: "exams/:id", element: <ExamBrief /> },
            ],
          },
          { path: "*", element: <NotFound /> },
        ],
      },
      // The exam itself runs outside the layout: no sidebar, no links out.
      {
        path: "exam/:attemptId",
        element: <RequireRole roles={["STUDENT"]} />,
        children: [
          { index: true, element: <ExamSession /> },
          { path: "done", element: <ExamDone /> },
        ],
      },
    ],
  },
]);
