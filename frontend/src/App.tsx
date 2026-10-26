import { useQueryClient } from "@tanstack/react-query";
import { Link, Navigate, Outlet, Route, Routes } from "react-router";
import { logout } from "./api.ts";
import { clearAuth, useAuth } from "./auth.ts";
import { SignInPage } from "./pages/SignInPage.tsx";
import { TaskListPage } from "./pages/TaskListPage.tsx";

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
      <header className="container">
        <nav>
          <ul>
            <li>
              <Link to="/tasks">
                <strong>To-Do</strong>
              </Link>
            </li>
          </ul>
          <ul>
            <li className="email">{auth.user.email}</li>
            <li>
              <button type="button" className="secondary" onClick={signOut}>
                Sign out
              </button>
            </li>
          </ul>
        </nav>
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
      </Route>
      <Route path="*" element={<Navigate to="/tasks" replace />} />
    </Routes>
  );
}

export default App;
