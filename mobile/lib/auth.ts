import { useEffect, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
} from "firebase/auth";
import { auth } from "./firebase";

const API_BASE = process.env.EXPO_PUBLIC_API_URL || "http://localhost:3000";

export type Role = "rider" | "driver";

export interface AuthUser {
  uid: string;
  name: string;
  email: string | null;
  phone?: string;
  role: Role;
  idNumber?: string;
  idDocumentName?: string;
  licenseDocumentName?: string;
}

const USER_KEY = "vura.auth.dbUser";

function mapMobileRole(backendRole: string): Role {
  return backendRole === "passenger" ? "rider" : "driver";
}

function mapBackendRole(role: Role): string {
  return role === "rider" ? "passenger" : "driver";
}

async function syncWithBackend(
  token: string,
  extra: { role: Role; phone?: string; full_name?: string }
) {
  const res = await fetch(`${API_BASE}/api/users/sync`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      token,
      role: mapBackendRole(extra.role),
      phone: extra.phone,
      full_name: extra.full_name,
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to sync user");
  }
  return res.json();
}

async function storeUser(user: AuthUser) {
  await AsyncStorage.setItem(USER_KEY, JSON.stringify(user));
}

export async function setUser(u: AuthUser) {
  await storeUser(u);
}

export async function clearUser() {
  await AsyncStorage.removeItem(USER_KEY);
}

export function useAuth() {
  const [user, setUserState] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const cached = AsyncStorage.getItem(USER_KEY).then((raw) => {
      if (raw) setUserState(JSON.parse(raw));
    });

    const unsub = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        const stored = await AsyncStorage.getItem(USER_KEY);
        if (stored) {
          setUserState(JSON.parse(stored));
        } else {
          try {
            const token = await firebaseUser.getIdToken();
            const { user: dbUser } = await syncWithBackend(token, {
              role: "rider",
            });
            const authUser: AuthUser = {
              uid: firebaseUser.uid,
              name: dbUser.full_name || firebaseUser.displayName || "Rider",
              email: firebaseUser.email,
              role: mapMobileRole(dbUser.role),
            };
            await storeUser(authUser);
            setUserState(authUser);
          } catch {
            const fallback: AuthUser = {
              uid: firebaseUser.uid,
              name: firebaseUser.displayName || "Rider",
              email: firebaseUser.email,
              role: "rider",
            };
            await storeUser(fallback);
            setUserState(fallback);
          }
        }
      } else {
        await AsyncStorage.removeItem(USER_KEY);
        setUserState(null);
      }
      setLoading(false);
    });

    return () => unsub();
  }, []);

  async function refresh() {
    const stored = await AsyncStorage.getItem(USER_KEY);
    if (stored) setUserState(JSON.parse(stored));
  }

  return { user, loading, refresh };
}

export async function login(email: string, password: string, role: Role) {
  const cred = await signInWithEmailAndPassword(auth, email, password);
  const token = await cred.user.getIdToken();

  const { user: dbUser } = await syncWithBackend(token, { role });

  const authUser: AuthUser = {
    uid: cred.user.uid,
    name: dbUser.full_name || cred.user.displayName || email.split("@")[0],
    email: cred.user.email,
    phone: dbUser.phone,
    role: mapMobileRole(dbUser.role),
  };
  await storeUser(authUser);
  return authUser;
}

export async function register(
  email: string,
  password: string,
  role: Role,
  extra: { full_name: string; phone?: string }
) {
  const cred = await createUserWithEmailAndPassword(auth, email, password);
  const token = await cred.user.getIdToken();

  const { user: dbUser } = await syncWithBackend(token, {
    role,
    full_name: extra.full_name,
    phone: extra.phone,
  });

  const authUser: AuthUser = {
    uid: cred.user.uid,
    name: dbUser.full_name || extra.full_name,
    email: cred.user.email,
    phone: extra.phone,
    role: mapMobileRole(dbUser.role),
  };
  await storeUser(authUser);
  return authUser;
}

export async function logout() {
  await signOut(auth);
  await AsyncStorage.removeItem(USER_KEY);
}
