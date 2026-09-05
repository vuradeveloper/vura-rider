import { auth } from "./firebase";
import { getApiUrl } from "./config";

/**
 * Hermes-safe request timeout.
 * `AbortSignal.timeout()` is NOT implemented on React Native Android
 * (Hermes), so every fetch that used it crashed with
 * "TypeError: undefined is not a function". Use an AbortController +
 * setTimeout instead, which works on Hermes, Node and browsers.
 */
function createTimeoutSignal(ms: number) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, timeoutId };
}

export async function apiFetch<T = any>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const url = getApiUrl(path);

  let authHeader: Record<string, string> = {};

  // Wait for Firebase Auth to finish initializing if it's currently null (avoid race conditions on refresh)
  let attempts = 0;
  while (!auth.currentUser && attempts < 15) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    attempts++;
  }

  if (auth.currentUser) {
    try {
      const token = await auth.currentUser.getIdToken();
      authHeader = { Authorization: `Bearer ${token}` };
    } catch {
      throw new Error("Your session expired. Please sign in again.");
    }
  }

  const { signal, timeoutId } = createTimeoutSignal(20000);

  try {
    const res = await fetch(url, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...authHeader,
        ...(options.headers as Record<string, string> | undefined),
      },
      signal,
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `Request failed: ${res.status}`);
    }

    return res.json();
  } finally {
    clearTimeout(timeoutId);
  }
}
