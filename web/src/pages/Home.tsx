import { useAuth } from "../auth";

const roleLabel = { SUPER_ADMIN: "Super Admin", INSTRUCTOR: "Instructor", STUDENT: "Student" } as const;

// M0 placeholder: the student dashboard, admin and instructor views arrive in M1.
export function Home() {
  const { user, logout } = useAuth();
  if (!user) return null;

  return (
    <div className="min-h-screen">
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-teal-600 text-lg font-bold text-white">
            X
          </div>
          <span className="font-bold text-slate-800">Xpand CS Academy</span>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right">
            <div className="text-sm font-bold">{user.fullName}</div>
            <div className="font-mono text-xs text-slate-500">{roleLabel[user.role]}</div>
          </div>
          <button onClick={logout} className="rounded-xl px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50">
            Logout
          </button>
        </div>
      </header>
      <main className="mx-auto max-w-4xl p-8">
        <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
          <h1 className="mb-2 text-2xl font-extrabold text-slate-800">Welcome back, {user.fullName.split(" ")[0]}.</h1>
          <p className="text-sm text-slate-500">Your dashboard is coming in the next release.</p>
        </div>
      </main>
    </div>
  );
}
