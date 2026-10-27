import { useQueryClient } from "@tanstack/react-query";
import { Link, Navigate, NavLink, Outlet, Route, Routes } from "react-router";
import { logout } from "./api.ts";
import { clearAuth, useAuth } from "./auth.ts";
import { FeaturesPage } from "./pages/FeaturesPage.tsx";
import { SignInPage } from "./pages/SignInPage.tsx";
import { StatusPage } from "./pages/StatusPage.tsx";
import { TaskDetailPage } from "./pages/TaskDetailPage.tsx";
import { TaskListPage } from "./pages/TaskListPage.tsx";
import { ThemeToggle } from "./components/ThemeToggle.tsx";

function RequireAuth() {
  const auth = useAuth();
  const queryClient = useQueryClient();
  if (!auth) return <Navigate to="/login" replace />;

  async function signOut() {
    // Signing out locally must work even if the server can't be reached.
    await logout().catch(() => {});
    clearAuth();
    queryClient.clear();
  }

  return (
    <>
      <header className="top">
        <Link to="/tasks" className="brand">
          To-Do
        </Link>
        <nav aria-label="Main" className="tabs">
          <NavLink to="/tasks">Tasks</NavLink>
          <NavLink to="/features">Features</NavLink>
          <NavLink to="/status">Status</NavLink>
        </nav>
        <span className="email">{auth.user.email}</span>
        <ThemeToggle />
        <button type="button" className="secondary" onClick={signOut}>
          Sign out
        </button>
      </header>
      <Outlet />
    </>
  );
}

function App() {
  return (
    <Routes>
      <Route path="/login" element={<SignInPage />} />
      <Route element={<RequireAuth />}>
        <Route path="/tasks" element={<TaskListPage />} />
        <Route path="/tasks/:id" element={<TaskDetailPage />} />
        <Route path="/features" element={<FeaturesPage />} />
        <Route path="/status" element={<StatusPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/tasks" replace />} />
    </Routes>
  );
}

export default App;
