import { useAuth } from "../../app/auth";
import { usePageTitle } from "../../app/pages";
import { Card } from "../../components/ui";

// Placeholder until the student dashboard (FRONTEND_GUIDE §4.2) is built.
export function StudentHome() {
  usePageTitle("My exams");
  const { user } = useAuth();
  return (
    <Card>
      <h1 className="mb-2 text-2xl font-extrabold text-slate-800">Welcome back, {user?.fullName.split(" ")[0]}.</h1>
      <p className="text-sm text-slate-600">Your dashboard is coming in the next release.</p>
    </Card>
  );
}
