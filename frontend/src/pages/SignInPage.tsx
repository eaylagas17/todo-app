import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRef } from "react";
import { Navigate } from "react-router";
import { login, register } from "../api.ts";
import { saveAuth, useAuth } from "../auth.ts";

type Attempt = { action: typeof login; email: string; password: string };

export function SignInPage() {
  const auth = useAuth();
  const queryClient = useQueryClient();
  const form = useRef<HTMLFormElement>(null);
  const attempt = useMutation({
    mutationFn: ({ action, email, password }: Attempt) =>
      action(email, password),
    onSuccess: (result) => {
      // A fresh cache, so nothing from a previous user can show (E26).
      queryClient.clear();
      saveAuth(result);
    },
  });

  // Covers both a visit while signed in and a successful attempt: saveAuth re-renders this page.
  if (auth) return <Navigate to="/tasks" replace />;

  function submit(action: typeof login) {
    if (!form.current?.reportValidity()) return;
    const data = new FormData(form.current);
    attempt.mutate({
      action,
      email: String(data.get("email")),
      password: String(data.get("password")),
    });
  }

  return (
    <main className="page narrow">
      <h1>Sign in</h1>
      <form
        ref={form}
        onSubmit={(event) => {
          event.preventDefault();
          submit(login);
        }}
      >
        <label>
          Email
          <input name="email" type="email" autoComplete="email" required />
        </label>
        <label>
          Password
          <input
            name="password"
            type="password"
            autoComplete="current-password"
            minLength={8}
            required
          />
        </label>
        {attempt.error && <p role="alert">{attempt.error.message}</p>}
        <div className="actions">
          <button
            type="submit"
            disabled={attempt.isPending}
            aria-busy={attempt.isPending}
          >
            Sign in
          </button>
          <button
            type="button"
            className="secondary"
            disabled={attempt.isPending}
            onClick={() => submit(register)}
          >
            Create account
          </button>
        </div>
      </form>
    </main>
  );
}
