import { useSyncExternalStore } from "react";
import type { AuthResult } from "./api.ts";

const KEY = "todo.auth";
const listeners = new Set<() => void>();

// Storage can throw (blocked cookies, private browsing) or hold corrupt data;
// either way the app treats it as signed out rather than crashing.
function load(): AuthResult | null {
  try {
    const saved = localStorage.getItem(KEY);
    return saved ? (JSON.parse(saved) as AuthResult) : null;
  } catch {
    return null;
  }
}

let current = load();

function publish(auth: AuthResult | null) {
  current = auth;
  listeners.forEach((listener) => listener());
}

export const getAuth = () => current;

export function saveAuth(auth: AuthResult) {
  try {
    localStorage.setItem(KEY, JSON.stringify(auth));
  } catch {
    // Storage blocked: the session still works until the tab closes.
  }
  publish(auth);
}

export function clearAuth() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Storage blocked: there is nothing saved to remove.
  }
  publish(null);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export const useAuth = () => useSyncExternalStore(subscribe, getAuth);
