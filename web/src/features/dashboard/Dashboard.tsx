import { useAuth } from "../../app/auth";
import { usePageTitle } from "../../app/pages";
import { PageHeader } from "../../components/ui";

// The super admin's start page. Numbers (admin stats) arrive in phase A2.
export function Dashboard() {
  usePageTitle("Dashboard");
  const { user } = useAuth();
  return (
    <PageHeader
      title={`Welcome back, ${user?.fullName.split(" ")[0] ?? ""}.`}
      description="Manage users, groups, access and exams from the menu."
    />
  );
}
