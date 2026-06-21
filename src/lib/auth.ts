// Simple client-only auth + role store (no backend).
export type Role = "rider" | "driver";
export interface AuthUser {
  name: string;
  email: string;
  phone?: string;
  role: Role;
  idNumber?: string;
  idDocumentName?: string;
  licenseDocumentName?: string;
}

const KEY = "vura.auth.user";

export function getUser(): AuthUser | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as AuthUser) : null;
  } catch {
    return null;
  }
}

export function setUser(u: AuthUser) {
  localStorage.setItem(KEY, JSON.stringify(u));
  window.dispatchEvent(new Event("vura:auth"));
}

export function clearUser() {
  localStorage.removeItem(KEY);
  window.dispatchEvent(new Event("vura:auth"));
}

import { useEffect, useState } from "react";
export function useAuth() {
  const [user, setU] = useState<AuthUser | null>(null);
  useEffect(() => {
    setU(getUser());
    const h = () => setU(getUser());
    window.addEventListener("vura:auth", h);
    window.addEventListener("storage", h);
    return () => {
      window.removeEventListener("vura:auth", h);
      window.removeEventListener("storage", h);
    };
  }, []);
  return user;
}
