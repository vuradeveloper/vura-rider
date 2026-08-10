import { useEffect, useState } from "react";
import * as SecureStore from "expo-secure-store";
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  sendEmailVerification,
  EmailAuthProvider,
  reauthenticateWithCredential,
  deleteUser,
  updatePassword as fbUpdatePassword,
} from "firebase/auth";
import { auth, FIREBASE_API_KEY } from "./firebase";
import { getApiUrl } from "./config";

export type Role = "rider" | "driver";

export interface AuthUser {
  uid: string;
  name: string;
  email: string | null;
  phone?: string;
  photoURL?: string | null;
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
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
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
        try {
          const token = await firebaseUser.getIdToken();
          const { user: dbUser } = await syncWithBackend(token, {
            role: mapMobileRole(firebaseUser.displayName || "").includes("driver") ? "driver" : "rider",
          });

          const authUser: AuthUser = {
            uid: firebaseUser.uid,
            name: dbUser.full_name || firebaseUser.displayName || "Rider",
            email: firebaseUser.email,
            phone: dbUser.phone || undefined,
            photoURL: dbUser.profile_photo_url || firebaseUser.photoURL,
            role: mapMobileRole(dbUser.role),
            idNumber: dbUser.id_number || undefined,
            idDocumentName: dbUser.id_document_name || undefined,
            licenseDocumentName: dbUser.license_document_name || undefined,
          };
          await storeUser(authUser);
          setUserState(authUser);

          // Sync with Zustand store
          const { useAppStore } = require("./store");
          useAppStore.getState().setUser({
            uid: firebaseUser.uid,
            email: firebaseUser.email,
            displayName: authUser.name,
            phoneNumber: authUser.phone || firebaseUser.phoneNumber || null,
            photoURL: authUser.photoURL || null,
          });
        } catch {
          // Backend sync failed — fall back to stored user if available
          const stored = await loadStoredUser();
          if (stored) {
            setUserState(stored);
            const { useAppStore } = require("./store");
            useAppStore.getState().setUser({
              uid: firebaseUser.uid,
              email: firebaseUser.email,
              displayName: stored.name,
              phoneNumber: stored.phone || firebaseUser.phoneNumber || null,
              photoURL: firebaseUser.photoURL || null,
            });
          } else {
            const fallback: AuthUser = {
              uid: firebaseUser.uid,
              name: firebaseUser.displayName || "Rider",
              email: firebaseUser.email,
              role: "rider",
            };
            await storeUser(fallback);
            setUserState(fallback);
            const { useAppStore } = require("./store");
            useAppStore.getState().setUser({
              uid: firebaseUser.uid,
              email: firebaseUser.email,
              displayName: fallback.name,
              phoneNumber: firebaseUser.phoneNumber || null,
              photoURL: firebaseUser.photoURL || null,
            });
          }
        }
      } else {
        await clearUser();
        setUserState(null);
        // Clear Zustand store
        const { useAppStore } = require("./store");
        useAppStore.getState().setUser(null);
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
    photoURL: dbUser.profile_photo_url || cred.user.photoURL,
    role: mapMobileRole(dbUser.role),
    idNumber: dbUser.id_number || undefined,
    idDocumentName: dbUser.id_document_name || undefined,
    licenseDocumentName: dbUser.license_document_name || undefined,
  };
  await storeUser(authUser);

  // Register for push notifications asynchronously
  try {
    const { registerForPushNotificationsAsync, registerDeviceToken } = require("./notifications");
    registerForPushNotificationsAsync().then((pushToken: string | null) => {
      if (pushToken) {
        registerDeviceToken(pushToken);
      }
    });
  } catch (error) {
    console.error("Error registering push token on login:", error);
  }

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
    phone: dbUser.phone || extra.phone,
    photoURL: dbUser.profile_photo_url || cred.user.photoURL,
    role: mapMobileRole(dbUser.role),
    idNumber: dbUser.id_number || undefined,
    idDocumentName: dbUser.id_document_name || undefined,
    licenseDocumentName: dbUser.license_document_name || undefined,
  };
  await storeUser(authUser);

  // Register for push notifications asynchronously
  try {
    const { registerForPushNotificationsAsync, registerDeviceToken } = require("./notifications");
    registerForPushNotificationsAsync().then((pushToken: string | null) => {
      if (pushToken) {
        registerDeviceToken(pushToken);
      }
    });
  } catch (error) {
    console.error("Error registering push token on registration:", error);
  }

  return authUser;
}

export async function logout() {
  await signOut(auth);
  await clearUser();
  try {
    const { disconnectSocket } = require("./socket");
    disconnectSocket();
  } catch (e) {
    console.error("Failed to disconnect socket on logout:", e);
  }
}

export async function resetPassword(email: string) {
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=${FIREBASE_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        requestType: "PASSWORD_RESET",
        email,
      }),
    }
  );
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    const msg = data.error?.message;
    if (msg === "EMAIL_NOT_FOUND") return;
    if (msg === "INVALID_EMAIL") throw { code: "auth/invalid-email", message: "Invalid email address." };
    throw new Error(msg || "Could not send reset email. Try again.");
  }
}

export async function changePassword(currentPassword: string, newPassword: string) {
  const user = auth.currentUser;
  if (!user || !user.email) throw new Error("No user signed in");

  const credential = EmailAuthProvider.credential(user.email, currentPassword);
  const cred = await reauthenticateWithCredential(user, credential);
  const currentUser = cred.user ?? auth.currentUser ?? user;
  await fbUpdatePassword(currentUser, newPassword);
}

export async function sendVerificationEmail() {
  if (!auth.currentUser) throw new Error("No user signed in");
  await sendEmailVerification(auth.currentUser);
}

const BIOMETRIC_CRED_KEY = "vura.auth.biometric";
const BIOMETRIC_ASKED_KEY = "vura.auth.biometric_asked";

export async function saveBiometricCredentials(email: string, password: string) {
  await SecureStore.setItemAsync(BIOMETRIC_CRED_KEY, JSON.stringify({ email, password }), {
    requireAuthentication: true,
  });
}

export async function getBiometricCredentials(): Promise<{ email: string; password: string } | null> {
  try {
    const raw = await SecureStore.getItemAsync(BIOMETRIC_CRED_KEY, {
      requireAuthentication: true,
    });
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function clearBiometricCredentials() {
  await SecureStore.deleteItemAsync(BIOMETRIC_CRED_KEY);
}

export async function hasBiometricCredentials(): Promise<boolean> {
  try {
    const raw = await SecureStore.getItemAsync(BIOMETRIC_CRED_KEY);
    return raw !== null;
  } catch {
    return false;
  }
}

export async function setBiometricAsked() {
  await SecureStore.setItemAsync(BIOMETRIC_ASKED_KEY, "true");
}

export async function wasBiometricAsked(): Promise<boolean> {
  try {
    return (await SecureStore.getItemAsync(BIOMETRIC_ASKED_KEY)) === "true";
  } catch {
    return false;
  }
}

export async function deleteAccount(password: string) {
  const user = auth.currentUser;
  if (!user || !user.email) throw new Error("No user signed in");

  const credential = EmailAuthProvider.credential(user.email, password);
  const cred = await reauthenticateWithCredential(user, credential);
  const currentUser = cred.user ?? auth.currentUser ?? user;

  const token = await currentUser.getIdToken();
  const res = await fetch(getApiUrl("/api/users/delete"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to delete account data");
  }

  await deleteUser(currentUser);
  await clearUser();
  await clearBiometricCredentials();
}
