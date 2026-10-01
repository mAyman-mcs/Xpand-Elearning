import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AuthProvider, useAuth } from "./auth";
import "./index.css";
import { ChangePassword } from "./pages/ChangePassword";
import { Home } from "./pages/Home";
import { Login } from "./pages/Login";

function App() {
  const { user, loading } = useAuth();
  if (loading) return <div className="flex min-h-screen items-center justify-center text-slate-400">Loading…</div>;
  if (!user) return <Login />;
  if (user.mustChangePassword) return <ChangePassword />;
  return <Home />;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AuthProvider>
      <App />
    </AuthProvider>
  </StrictMode>,
);
