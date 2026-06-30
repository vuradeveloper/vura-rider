import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useState } from "react";

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

export async function getUser(): Promise<AuthUser | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as AuthUser) : null;
  } catch {
    return null;
  }
}

export async function setUser(u: AuthUser) {
  await AsyncStorage.setItem(KEY, JSON.stringify(u));
}

export async function clearUser() {
  await AsyncStorage.removeItem(KEY);
}

export function useAuth() {
  const [user, setU] = useState<AuthUser | null>(null);

  useEffect(() => {
    getUser().then(setU);
  }, []);

  function refresh() {
    getUser().then(setU);
  }

  return { user, refresh };
}
