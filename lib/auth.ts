import { useEffect, useState } from "react";
import * as SecureStore from "expo-secure-store";
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
} from "firebase/auth";
import { auth } from "./firebase";
import { getApiUrl } from "./config";

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
let memoryUser: AuthUser | null = null;

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
  const res = await fetch(getApiUrl("/api/users/sync"), {
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

async function isSecureStoreAvailable() {
  try {
    return await SecureStore.isAvailableAsync();
  } catch {
    return false;
  }
}

async function loadStoredUser(): Promise<AuthUser | null> {
  if (!(await isSecureStoreAvailable())) return memoryUser;

  const raw = await SecureStore.getItemAsync(USER_KEY);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as AuthUser;
    memoryUser = parsed;
    return parsed;
  } catch {
    await SecureStore.deleteItemAsync(USER_KEY);
    return null;
  }
}

async function storeUser(user: AuthUser) {
  memoryUser = user;

  if (await isSecureStoreAvailable()) {
    await SecureStore.setItemAsync(USER_KEY, JSON.stringify(user), {
      keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
    });
  }
}

export async function setUser(u: AuthUser) {
  await storeUser(u);
}

export async function clearUser() {
  memoryUser = null;

  if (await isSecureStoreAvailable()) {
    await SecureStore.deleteItemAsync(USER_KEY);
  }
}

export function useAuth() {
  const [user, setUserState] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadStoredUser()
      .then((stored) => {
        if (stored) setUserState(stored);
      })
      .catch(() => undefined);

    const unsub = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        const stored = await loadStoredUser();
        if (stored) {
          setUserState(stored);
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
        await clearUser();
        setUserState(null);
      }

      setLoading(false);
    });

    return () => unsub();
  }, []);

  async function refresh() {
    const stored = await loadStoredUser();
    if (stored) setUserState(stored);
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
  await clearUser();
}
