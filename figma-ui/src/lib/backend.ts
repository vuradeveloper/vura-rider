// ─────────────────────────────────────────────────────────────────────────────
// Backend integration for the Figma UI.
//
// Connects the Figma screens to the SAME backend the React Native driver app
// uses — same API, same Firebase project, same socket server. Nothing on the
// server changes; this file is the single place the web UI talks to it.
//
// Auth uses Firebase's REST API rather than the Firebase JS SDK: it returns the
// same idToken the server already accepts as `Authorization: Bearer <token>`,
// and it avoids pulling a large SDK into the WebView.
// ─────────────────────────────────────────────────────────────────────────────

export const API_URL = "https://api.ridevura.com";

// ─── HTTP transport ──────────────────────────────────────────────────────────
// Single entry point for every network call the app makes.
//
// WHY THIS EXISTS: inside the Capacitor Android WebView the page runs at origin
// `https://localhost`, and the API's CORS policy only allows the real website
// origins. Verified with a live preflight against api.ridevura.com:
//
//     Origin: https://localhost      -> NO Access-Control-Allow-Origin
//     Origin: http://localhost       -> NO Access-Control-Allow-Origin
//     Origin: capacitor://localhost  -> NO Access-Control-Allow-Origin
//     Origin: https://ridevura.com   -> Access-Control-Allow-Origin: (allowed)
//
// A browser fetch() is therefore rejected before any status is readable, which
// surfaces as "TypeError: Failed to fetch" — the exact error seen on Earnings,
// Documents and Link-your-car. The old React Native app never hit this because
// it made NATIVE http calls, where CORS does not apply.
//
// So: run natively through CapacitorHttp (no preflight, no Origin, no CORS) and
// fall back to browser fetch on the web build.

type HttpResult = { status: number; ok: boolean; text: string };

async function httpFetch(
  url: string,
  init: { method?: string; headers?: Record<string, string>; body?: string } = {}
): Promise<HttpResult> {
  const method = init.method || "GET";
  const headers = init.headers || {};

  try {
    const core = await import("@capacitor/core");
    const onNative = !!core?.Capacitor?.isNativePlatform?.();
    // Only take the native path when the plugin is actually present, otherwise
    // fall through to the browser so a missing plugin degrades instead of
    // throwing a confusing "cannot read property 'request'" error.
    const http = (core as any)?.CapacitorHttp;
    if (onNative && http?.request) {
      const res: any = await http.request({
        url,
        method,
        headers,
        // CapacitorHttp only accepts a string/JSON body on Android/iOS.
        ...(init.body != null ? { data: init.body } : {}),
        readTimeout: 60000,
        connectTimeout: 30000,
      });
      const text =
        typeof res?.data === "string"
          ? res.data
          : res?.data == null
            ? ""
            : JSON.stringify(res.data);
      const status = Number(res?.status ?? 0);
      return { status, ok: status >= 200 && status < 300, text };
    }
  } catch (err: any) {
    // A native transport failure (no radio, DNS, TLS) — report it plainly.
    const msg = String(err?.message || err || "");
    if (msg && !/undefined|not a function|request/i.test(msg)) {
      throw new Error(msg);
    }
    // Otherwise fall through to the browser transport below.
  }

  const res = await fetch(url, { method, headers, body: init.body });
  const text = await res.text();
  return { status: res.status, ok: res.ok, text };
}

// IMPORTANT: this must be the project the DRIVER app uses — vura-f667d. The
// rider app uses vura-a272c, and signing in against the wrong project returns a
// token the server (which verifies against vura-f667d) rejects. Key taken from
// vura-driver/lib/firebase.ts.
const FIREBASE_API_KEY = "AIzaSyC3lSrWd0JHWS8FzyaW9h8GgQyzNK3sC3Q";
const FIREBASE_PROJECT_ID = "vura-f667d";
const IDENTITY = "https://identitytoolkit.googleapis.com/v1/accounts";

const TOKEN_KEY = "vura.idToken";

// ── Auth ─────────────────────────────────────────────────────────────────────

export type AuthUser = {
  uid: string;
  email: string | null;
  idToken: string;
  /** Firebase refresh token — lets us mint a new idToken without re-login. */
  refreshToken?: string;
  /** Epoch ms when idToken expires (Firebase tokens last 1 hour). */
  expiresAt?: number;
  /** The row POST /api/users/sync returned, cached exactly like the native app
   *  caches it in AsyncStorage at login (that is where the display name lives,
   *  because the live server has no GET /api/users/me endpoint). */
  dbUser?: {
    id?: string;
    full_name?: string | null;
    phone?: string | null;
    role?: string | null;
  };
};

let currentUser: AuthUser | null = null;

export function getStoredUser(): AuthUser | null {
  try {
    const raw = localStorage.getItem(TOKEN_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AuthUser;
    currentUser = parsed;
    return parsed;
  } catch {
    return null;
  }
}

function storeUser(u: AuthUser | null) {
  currentUser = u;
  try {
    if (u) localStorage.setItem(TOKEN_KEY, JSON.stringify(u));
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage unavailable — session stays in memory only */
  }
}

async function identityCall(path: string, body: Record<string, unknown>) {
  const res = await httpFetch(`${IDENTITY}:${path}?key=${FIREBASE_API_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json: any = res.text ? (() => { try { return JSON.parse(res.text); } catch { return {}; } })() : {};
  if (!res.ok) {
    const msg = json?.error?.message || `Auth failed (${res.status})`;
    // Friendlier versions of Firebase's codes.
    const friendly: Record<string, string> = {
      EMAIL_EXISTS: "That email is already registered. Try signing in.",
      EMAIL_NOT_FOUND: "No account found with that email.",
      INVALID_PASSWORD: "Incorrect password.",
      INVALID_LOGIN_CREDENTIALS: "Incorrect email or password.",
      WEAK_PASSWORD: "Password must be at least 6 characters.",
      INVALID_EMAIL: "That email address doesn't look right.",
      OPERATION_NOT_ALLOWED: "Email sign-in is disabled for this project.",
    };
    throw new Error(friendly[String(msg)] || String(msg));
  }
  return json;
}

function toUser(json: any): AuthUser {
  return {
    uid: json.localId,
    email: json.email ?? null,
    idToken: json.idToken,
    refreshToken: json.refreshToken ?? undefined,
    expiresAt: json.expiresIn ? Date.now() + Number(json.expiresIn) * 1000 : undefined,
  };
}

// ── Token freshness ──────────────────────────────────────────────────────────
// Firebase idTokens expire after ONE HOUR. The React Native app never hit this
// because the Firebase SDK's getIdToken() refreshes silently; here we store the
// token ourselves, so we must refresh it too — otherwise every call starts
// returning 401 and every list (documents, earnings, trips) silently goes empty.

let refreshing: Promise<string | null> | null = null;

/** Exchanges the stored refresh token for a fresh idToken. */
export async function refreshIdToken(): Promise<string | null> {
  if (refreshing) return refreshing; // de-duplicate parallel refreshes
  const current = getStoredUser();
  const refreshToken = current?.refreshToken;
  if (!refreshToken) return null;

  refreshing = (async () => {
    try {
      const res = await httpFetch(
        `https://securetoken.googleapis.com/v1/token?key=${FIREBASE_API_KEY}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(refreshToken)}`,
        }
      );
      const json: any = res.text ? (() => { try { return JSON.parse(res.text); } catch { return {}; } })() : {};
      if (!res.ok || !json?.id_token) return null;
      const updated: AuthUser = {
        uid: json.user_id || current!.uid,
        email: current!.email,
        idToken: json.id_token,
        // Google rotates the refresh token on each refresh — always keep the new one.
        refreshToken: json.refresh_token || refreshToken,
        expiresAt: Date.now() + Number(json.expires_in || 3600) * 1000,
      };
      storeUser(updated);
      return updated.idToken;
    } catch {
      return null;
    } finally {
      refreshing = null;
    }
  })();

  return refreshing;
}

/** True when the stored token is missing, or within 5 minutes of expiring. */
export function tokenNeedsRefresh(): boolean {
  const u = getStoredUser();
  if (!u?.idToken) return true;
  if (!u.expiresAt) return false; // older sessions have no expiry recorded
  return Date.now() > u.expiresAt - 5 * 60 * 1000;
}

/**
 * Confirms the stored session is still usable, refreshing it when it can.
 *
 * Why this exists: sessions saved by earlier builds kept ONLY the idToken (no
 * refresh token), and a Firebase idToken dies after an hour. When that happens
 * every authenticated call returns 401 and every list — documents, earnings,
 * trips — renders empty, which looks like "nothing is being pulled" even though
 * the data is there. This detects that state and forces a clean re-login, which
 * stores a refresh token so the session can renew itself from then on.
 */
export async function ensureSession(): Promise<boolean> {
  const u = getStoredUser();
  if (!u?.idToken) return false;

  // Case 1: an old session with no way to renew itself, already expired.
  if (!u.refreshToken && tokenNeedsRefresh()) return false;

  // Case 2: renewable but near expiry — refresh up front.
  if (tokenNeedsRefresh()) {
    const fresh = await refreshIdToken();
    if (fresh) return true;
  }

  // Case 3: ask the server. /api/drivers/stats is cheap and auth-gated.
  try {
    await apiFetch("/api/drivers/stats");
    return true;
  } catch (e: any) {
    if (e?.status === 401) {
      const fresh = await refreshIdToken();
      if (!fresh) return false;
      try {
        await apiFetch("/api/drivers/stats");
        return true;
      } catch {
        return false;
      }
    }
    // Offline or a server error — keep the session; the app still works once
    // connectivity returns. Only a definitive 401 should log the driver out.
    return true;
  }
}

/**
 * Mirrors the React Native RIDER app's `syncWithBackend()` EXACTLY — same
 * endpoint, same body, same header. This is the call that creates/updates the
 * user row. The rider app signs everyone up as role "passenger" (its local
 * "rider" role maps to "passenger" on the backend — see vura-rider/lib/auth.ts),
 * and a signup may carry a referral code.
 */
export async function syncWithBackend(
  token: string,
  role: "driver" | "passenger",
  full_name?: string,
  phone?: string,
  referralCode?: string
) {
  const res = await httpFetch(`${API_URL}/api/users/sync`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ token, role, full_name, phone, referralCode }),
  });
  const parsed: any = res.text ? (() => { try { return JSON.parse(res.text); } catch { return {}; } })() : {};
  if (!res.ok) {
    throw new Error(parsed?.error || "Failed to sync user");
  }
  return parsed;
}

export async function signIn(email: string, password: string): Promise<AuthUser> {
  const json = await identityCall("signInWithPassword", {
    email: email.trim(),
    password,
    returnSecureToken: true,
  });
  const user = toUser(json);
  storeUser(user);
  // The native login runs the same sync so the DB row exists/updates, and keeps
  // the returned row (name/phone/role) in local storage. Mirror that.
  // Role is "passenger" — this is the rider app.
  try {
    const synced: any = await syncWithBackend(user.idToken, "passenger");
    if (synced?.user) {
      const withDb = { ...getStoredUser()!, dbUser: synced.user };
      storeUser(withDb);
    }
  } catch {
    /* row may already exist; not fatal */
  }
  return getStoredUser() || user;
}

export async function signUp(
  email: string,
  password: string,
  extra: { fullName: string; phone?: string; referralCode?: string }
): Promise<AuthUser> {
  const json = await identityCall("signUp", {
    email: email.trim(),
    password,
    returnSecureToken: true,
  });
  const user = toUser(json);
  storeUser(user);
  // Exactly what the native rider signup sends: full_name as ONE string, phone
  // as countryCode + digits, role "passenger", plus the optional referral code.
  try {
    const synced: any = await syncWithBackend(
      user.idToken,
      "passenger",
      extra.fullName,
      extra.phone,
      extra.referralCode
    );
    if (synced?.user) {
      const withDb = { ...getStoredUser()!, dbUser: synced.user };
      storeUser(withDb);
    }
  } catch {
    /* not fatal — the DB row is created on the next sync */
  }
  return getStoredUser() || user;
}

export function signOut() {
  storeUser(null);
}

export function getToken(): string | null {
  return currentUser?.idToken ?? getStoredUser()?.idToken ?? null;
}

// ── REST ─────────────────────────────────────────────────────────────────────

export async function apiFetch<T = any>(
  path: string,
  init: RequestInit = {}
): Promise<T> {
  // Refresh BEFORE the call when the token is close to expiry, otherwise the
  // first request after the hour mark always fails.
  if (tokenNeedsRefresh()) await refreshIdToken().catch(() => {});

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...((init.headers as Record<string, string>) || {}),
  };
  const method = (init.method as string) || "GET";
  const body = typeof init.body === "string" ? init.body : undefined;

  const send = async (token: string | null) =>
    httpFetch(`${API_URL}${path}`, {
      method,
      headers: token ? { ...headers, Authorization: `Bearer ${token}` } : headers,
      body,
    });

  let res = await send(getToken());

  // A 401 means the token expired (or was never accepted). Mint a new one once
  // and retry, so a long-lived session keeps working exactly like the native
  // app's SDK-based apiFetch does.
  if (res.status === 401) {
    const fresh = await refreshIdToken().catch(() => null);
    if (fresh) res = await send(fresh);
  }

  const text = res.text;
  const json = text ? (() => { try { return JSON.parse(text); } catch { return text; } })() : null;
  if (!res.ok) {
    const msg =
      (json as any)?.error || (typeof json === "string" ? json : `Request failed (${res.status})`);
    // Carry the status so the UI can explain what went wrong instead of showing
    // an empty list (which is what used to happen — every failure was swallowed).
    const err: any = new Error(String(msg));
    err.status = res.status;
    throw err;
  }
  return json as T;
}

// ── Socket.IO (same server, same events as the React Native driver app) ──────

type Listener = (data: any) => void;

let socket: any = null;
const listeners = new Map<string, Set<Listener>>();

function emitLocal(event: string, data: any) {
  listeners.get(event)?.forEach((fn) => {
    try {
      fn(data);
    } catch {
      /* a bad listener must not kill the socket */
    }
  });
}

/** Subscribe to a server event. Returns an unsubscribe function. */
export function on(event: string, fn: Listener): () => void {
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event)!.add(fn);
  return () => listeners.get(event)?.delete(fn);
}

/** Connect (or reuse) the socket, authenticated with the Firebase idToken. */
export async function getSocket(): Promise<any> {
  if (socket?.connected) return socket;
  // Refresh BEFORE the handshake: socket.io captures `auth` once at creation and
  // re-sends that same payload on every retry, so a stale Firebase idToken makes
  // every reconnection fail forever. Booking goes over this socket, so a dead
  // socket means "Confirm" silently never reaches a driver.
  if (tokenNeedsRefresh()) await refreshIdToken().catch(() => {});
  if (!socket) {
    const { io } = await import("socket.io-client");
    socket = io(API_URL, {
      // Same transport order as the old apps: polling as a fallback. Websocket-only
      // meant that on a network that blocks the upgrade the socket never connected,
      // so "Confirm" silently never reached a driver.
      transports: ["websocket", "polling"],
      auth: { token: getToken() },
      autoConnect: true,
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
    });
    // Fan every server event out to subscribers.
    [
      "ride:request",
      "ride:accepted",
      "ride:driver:arrived",
      "ride:started",
      "ride:completed",
      "ride:cancelled",
      "ride:request:expired",
      "ride:status",
      "ride:requested:ack",
      "ride:no:drivers",
      "ride:expired",
      "driver:location:update",
      "chat:message",
      "connect",
      "connect_error",
      "disconnect",
    ].forEach((evt) => {
      socket.on(evt, (data: any) => emitLocal(evt, data));
    });

    // Force a fresh token and retry immediately, as the old apps do, instead of
    // waiting out the backoff — rate-limited so a down server isn't hammered.
    let lastForcedRetry = 0;
    socket.on("connect_error", async () => {
      const fresh = await refreshIdToken().catch(() => null);
      if (fresh) socket.auth = { token: fresh };
      const now = Date.now();
      if (fresh && now - lastForcedRetry > 2000) {
        lastForcedRetry = now;
        try {
          socket.connect();
        } catch {
          /* the next attempt tries again */
        }
      }
    });

    socket.on("connect", () => {
      const t = getToken();
      if (t) socket.auth = { token: t };
      // Register as a PASSENGER. This used to emit "driver:online", which is the
      // driver's event — it writes driver_profiles.is_online for whoever sends it,
      // so a rider was marking themselves as an available driver.
      socket.emit("passenger:connect");
    });
  }
  if (!socket.connected) await new Promise<void>((resolve) => {
    socket.once("connect", () => resolve());
    setTimeout(resolve, 4000); // never hang the UI on a dead network
  });
  return socket;
}

/**
 * Reconnects if the socket dropped — used when the app returns to the foreground,
 * because Android tears WebSockets down for a backgrounded app.
 */
export async function ensureSocketLive(): Promise<boolean> {
  const s = await getSocket().catch(() => null);
  if (!s) return false;
  if (!s.connected) {
    try {
      if (tokenNeedsRefresh()) await refreshIdToken().catch(() => {});
      s.auth = { token: getToken() };
      s.connect();
    } catch {
      /* the connect handler re-registers once it succeeds */
    }
  }
  return !!s.connected;
}

/** True while the server connection is up. */
export function isSocketConnected(): boolean {
  return !!socket?.connected;
}

export function socketEmit(event: string, payload?: any) {
  try {
    socket?.emit(event, payload);
  } catch {
    /* best-effort */
  }
}

/**
 * Re-announces the driver's online state to the server.
 *
 * The native app does this on EVERY socket (re)connect
 * (app/index.tsx: `socket.on("connect", () => socket.emit("driver:online", …))`)
 * so that a dropped connection, a backgrounded app, or a server restart does not
 * silently leave the driver un-matched. We call it on connect AND on launch when
 * the persisted state says the driver was online.
 */
export async function resyncOnlineState() {
  const on = getStoredOnline();
  const s = await getSocket();
  s.emit("driver:online", { online: on });
  return on;
}

// ── Driver actions (mirror the RN driver app's endpoints/events) ─────────────

export type RideRequest = {
  id: string;
  pickupAddress: string;
  pickupLat: number;
  pickupLng: number;
  destinationAddress: string;
  destinationLat: number;
  destinationLng: number;
  fare: number;
  paymentMethod: string;
  riderName: string;
  riderRating: number;
  scheduledAt?: string | null;
  isScheduled?: boolean;
};

// ── Driver online state ──────────────────────────────────────────────────────
// The native app persists this locally so the driver is still online after
// closing and reopening the app (app/index.tsx: AsyncStorage "vura.driver.online",
// written on toggle and read on launch). We use the web equivalent, same key.
const ONLINE_KEY = "vura.driver.online";

export function getStoredOnline(): boolean {
  try {
    return localStorage.getItem(ONLINE_KEY) === "1";
  } catch {
    return false;
  }
}

export function setStoredOnline(on: boolean) {
  try {
    localStorage.setItem(ONLINE_KEY, on ? "1" : "0");
  } catch {
    /* storage unavailable — state stays in memory for this session */
  }
}

/**
 * Go online / offline.
 *
 * VERIFIED AGAINST THE LIVE SERVER (figma-ui/_diag4.mjs):
 *   driver:online {online:true}  -> is_online = TRUE    ✅
 *   driver:online {online:false} -> is_online = FALSE   ✅ honours the payload
 *   driver:offline               -> NO EFFECT           ❌ not implemented live
 *
 * This is why the native app sends a single event with a boolean payload
 * (app/index.tsx: `socket.emit("driver:online", { online: next })`) instead of
 * using driver:offline. Earlier I "fixed" this to emit driver:offline based on
 * the STALE local server source; the live server proved that wrong.
 *
 * The state is also persisted locally so it survives closing the app.
 */
export async function goOnline(online: boolean) {
  const s = await getSocket();
  s.emit("driver:online", { online });
  setStoredOnline(online);
}

export async function publishLocation(lat: number, lng: number, heading = 0) {
  const s = await getSocket();
  s.emit("driver:location", { lat, lng, heading });
}

export async function acceptRide(rideId: string, deviceId = "") {
  const s = await getSocket();
  s.emit("driver:ride:accept", { rideId, deviceId });
}

export async function declineRide(rideId: string) {
  const s = await getSocket();
  s.emit("driver:ride:decline", { rideId });
}

export type DriverStats = {
  today: { rides: number; earned: number };
  thisMonth: { rides: number; earned: number };
  allTime: { rides: number; earned: number };
  rating: { average: number };
};

export const getDriverStats = () => apiFetch<DriverStats>("/api/drivers/stats");

/**
 * The driver's profile row (vehicle details).
 *
 * Response shape verified against the LIVE server with a real driver token:
 *     GET /api/drivers/profile -> 200 { "profile": { ... } | null }
 * This is the same call the native app makes (`const p = res?.profile`).
 * `driver_profile` is accepted as a fallback for other server builds.
 */
export const getMyProfile = async () => {
  const res = await apiFetch<{ profile?: any; driver_profile?: any }>("/api/drivers/profile");
  return res?.profile ?? res?.driver_profile ?? null;
};

/**
 * Saves a linked car on the SERVER — PATCH /api/drivers/profile.
 *
 * Same contract the driver app uses (and the live server's PATCH handler):
 * vehicle_make, vehicle_model, vehicle_year, vehicle_color, license_plate,
 * vehicle_type, vehicle_vin, odometer_km, license_number.
 *
 * This app is rider-only, so the only caller is the (unreachable) Link-your-car
 * screen copied from the driver app — kept identical so the two stay in step.
 * Empty values are dropped instead of written.
 */
export async function saveVehicle(input: {
  make?: string;
  model?: string;
  year?: string | number;
  color?: string;
  plate?: string;
  type?: string;
  vin?: string;
  odometer?: string | number;
  licenseNumber?: string;
}) {
  const body: Record<string, unknown> = {};
  const put = (key: string, value: string | number | undefined) => {
    if (value === undefined) return;
    const v = typeof value === "string" ? value.trim() : value;
    if (v === "" || v === null) return;
    body[key] = v;
  };
  put("vehicle_make", input.make);
  put("vehicle_model", input.model);
  put("vehicle_year", input.year);
  put("vehicle_color", input.color);
  put("license_plate", input.plate);
  put("vehicle_type", input.type);
  put("vehicle_vin", input.vin);
  put("odometer_km", input.odometer);
  put("license_number", input.licenseNumber);

  if (Object.keys(body).length === 0) return null;
  return apiFetch<any>("/api/drivers/profile", {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

/**
 * The signed-in user's own row (name, phone, role).
 *
 * The live server has NO GET /api/users/me (it 404s), so the only place this
 * data comes from is the response of POST /api/users/sync — which is exactly
 * what the native app relies on: it stores `dbUser.full_name` at login time.
 * We mirror that by persisting it into the stored session.
 */
export function getStoredProfileInfo(): { full_name?: string; phone?: string; id?: string; role?: string } {
  const u = getStoredUser() as any;
  return {
    full_name: u?.full_name ?? u?.dbUser?.full_name ?? undefined,
    phone: u?.phone ?? u?.dbUser?.phone ?? undefined,
    id: u?.dbUserId ?? u?.dbUser?.id ?? undefined,
    role: u?.dbUser?.role ?? undefined,
  };
}

export type EarningsTotals = {
  rides: number;
  gross: number;
  fee: number;
  net: number;
  /** Previous week's net — the live server returns it (verified via live call),
   *  and the native app uses it for the "+X% vs last week" badge. */
  lastWeekNet?: number;
};
export type EarningsDay = { date: string; rides: number; gross: number; fee: number; net: number };
export type Earnings = { period: string; totals: EarningsTotals; breakdown: EarningsDay[] };

/**
 * GET /api/earnings?period=today|week|month|year — the exact endpoint the React
 * Native driver app's earnings screen calls. `totals.net` is what the driver
 * actually takes home, and `breakdown` is grouped per day, which is what the
 * Mon..Sun bars are built from.
 */
export const getEarnings = (period: "today" | "week" | "month" | "year" = "week") =>
  apiFetch<Earnings>(`/api/earnings?period=${period}`);

/**
 * Money available to pay out — the SAME figure the Payments and Withdrawals
 * screen shows and the same call the native app's wallet makes:
 *   GET /api/payments/driver/earnings/pending -> { total_earnings, total_rides }
 * which excludes cash rides. Verified live, so DriverHome's "Balance", the
 * Account "Money" card and the wallet all agree on one number.
 *
 * (An earlier version used the week's net from /api/earnings, which counts cash
 * too — that would have shown a driver more than they could actually take out.)
 */
export const getWalletBalance = () =>
  apiFetch<{ total_earnings: number; total_rides: number }>(
    "/api/payments/driver/earnings/pending"
  ).then((d) => ({ total_earnings: Number(d?.total_earnings) || 0 }));

export const getRecentTrips = (limit = 3) =>
  apiFetch<{ rides: any[] }>(`/api/rides/history?limit=${limit}`);
export const getAvailableRides = () => apiFetch<{ rides: any[] }>("/api/rides/available");

/**
 * Full ride row for one trip — carries the real money columns the earnings
 * screen uses: actual_fare, platform_fee and driver_earned.
 */
export const getRide = (id: string) =>
  apiFetch<{ ride: any }>(`/api/rides/${id}`).then((r) => r?.ride ?? null);

/**
 * GET /api/rides/history returns aliased columns — `pickup`, `destination`,
 * `date`, `counterpart_name` — while other server builds return the raw names
 * (`pickup_address`, `destination_address`, `completed_at`, `passenger_name`).
 * Reading both keeps the UI correct whichever build answers.
 */
export function normalizeRide(r: any) {
  const date = r?.date ?? r?.completed_at ?? r?.created_at ?? null;
  return {
    id: String(r?.id ?? ""),
    pickup: r?.pickup ?? r?.pickup_address ?? "Pickup",
    destination: r?.destination ?? r?.destination_address ?? "Drop-off",
    partner: r?.counterpart_name ?? r?.passenger_name ?? r?.driver_name ?? "Rider",
    fare: Number(r?.fare ?? r?.actual_fare ?? 0) || 0,
    rating: r?.rating ?? r?.rating_score ?? null,
    distanceKm: Number(r?.distance_km ?? 0) || 0,
    durationMins: Number(r?.duration_mins ?? 0) || 0,
    date,
  };
}

/** Live GPS position, shared by every screen that shows a map. */
export function getMyLocation(
  opts: PositionOptions = { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 }
): Promise<{ lat: number; lng: number; heading: number }> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("Location is not available on this device"));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (p) =>
        resolve({
          lat: p.coords.latitude,
          lng: p.coords.longitude,
          heading: p.coords.heading ?? 0,
        }),
      (e) => reject(new Error(e.message || "Could not get your location")),
      opts
    );
  });
}

/** Rands, matching the RN app's formatting. */
export function formatRand(n: any) {
  const num = Number(n);
  const safe = Number.isFinite(num) ? num : 0;
  const [whole, frac] = safe.toFixed(2).split(".");
  return `R${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${frac}`;
}

/**
 * Opens Waze to a destination.
 *
 * Uses Waze's universal link (waze.com/ul) rather than the `waze://` scheme the
 * native app uses: inside a WebView the universal link is what launches the
 * installed Waze app on Android, and it degrades to the Waze website if Waze
 * isn't installed. Honours the same `vura.waze.enabled` toggle the Account
 * screen writes and the React Native app reads.
 */
export function openWaze(lat?: number | null, lng?: number | null, opts?: { from?: { lat: number; lng: number } }) {
  if (lat == null || lng == null) return false;
  try {
    if (localStorage.getItem("vura.waze.enabled") === "false") return false;
  } catch {
    /* storage unavailable — default to opening Waze */
  }
  const from = opts?.from ? `&from=ll.${opts.from.lat},${opts.from.lng}` : "";
  const url = `https://waze.com/ul?ll=${lat},${lng}&navigate=yes${from}`;
  window.open(url, "_blank");
  return true;
}

/** Starts the trip on the server — the same event the native app emits. */
export async function startTrip(rideId: string) {
  const s = await getSocket();
  s.emit("driver:ride:start", { rideId });
}

/** Marks the trip finished on the server. */
export async function completeTrip(rideId: string) {
  const s = await getSocket();
  s.emit("driver:ride:complete", { rideId });
}

/** Gets the driver's current profile row (used by Account + Documents). */
// GET /api/drivers/profile is exposed through getMyProfile() above, which also
// falls back to /api/users/me for builds that only serve the latter.

// ── Payments & withdrawals ───────────────────────────────────────────────────
// Verified live (figma-ui/_paycheck.mjs, _payclean.mjs):
//
//   GET    /api/payments/driver/earnings/pending -> { total_earnings, total_rides }
//          ^ THE non-cash figure. Confirmed by comparing against the ride history:
//            completed: 14 rides R3.92  (cash 9/R1.80, null 4/R1.92, card 1/R0.20)
//            endpoint :  5 rides R2.12  = card + null, i.e. CASH IS EXCLUDED
//          This is exactly "money that came in to the card, not cash money" —
//          and it is the same call the native app's wallet makes.
//
//   GET    /api/payments/methods     -> [{ id, card_type, last4, bank, is_default }]
//   POST   /api/payments/methods     -> 201 { id, ... }   body { card_type, last4, bank }
//   DELETE /api/payments/methods/:id -> { success: true }
//   GET    /api/payments/banks       -> [{ name, code }]  (10 real SA banks)
//
//   POST /api/payouts/resolve  and  POST /api/payouts/request  -> 404 (not deployed
//   on this server), so a withdrawal is recorded on the device and shown as a
//   request rather than pretending money moved.

export type PaymentMethod = {
  id: string;
  card_type?: string | null;
  last4?: string | null;
  bank?: string | null;
  is_default?: boolean;
};

export type Bank = { name: string; code: string };

/**
 * Money that came in on CARD / non-cash rides and is available to withdraw.
 * Cash rides are excluded by the server — see the note above.
 */
export const getPendingCardEarnings = () =>
  apiFetch<{ total_earnings: number; total_rides: number }>(
    "/api/payments/driver/earnings/pending"
  );

export const getPaymentMethods = () =>
  apiFetch<PaymentMethod[]>("/api/payments/methods");

export const addPaymentMethod = (input: {
  card_type?: string;
  last4?: string;
  bank?: string | null;
  is_default?: boolean;
}) =>
  apiFetch<PaymentMethod>("/api/payments/methods", {
    method: "POST",
    body: JSON.stringify(input),
  });

export const deletePaymentMethod = (id: string) =>
  apiFetch<{ success: boolean }>(`/api/payments/methods/${id}`, { method: "DELETE" });

/**
 * Starts a Paystack card registration — a hosted checkout carrying a small
 * pre-auth hold. Verified live against the server:
 *   POST /api/payments/card-register -> 200
 *   { reference: "VURACARD…", authorizationUrl: "https://checkout.paystack.com/…", live: true }
 *
 * The caller opens `authorizationUrl` in the OS browser (3-D Secure / OTP needs a
 * real browser, not an in-app view) and then polls verifyPayment() until the card
 * is stored. This is the same two-step flow the native app uses
 * (services/PaymentService.ts registerPaystackCard + app/add-payment-method.tsx).
 */
export const registerPaystackCard = () =>
  apiFetch<{ reference: string; authorizationUrl?: string; live?: boolean; error?: string }>(
    "/api/payments/card-register",
    { method: "POST", body: JSON.stringify({}) }
  );

/**
 * Checks a Paystack transaction. `status` is the field that matters:
 *   success | completed | refunded  -> card saved, stop polling
 *   failed                          -> genuine decline, stop immediately
 *   abandoned | pending             -> NOT terminal early on. Paystack reports
 *                                      "abandoned" for a checkout that simply
 *                                      has not been paid yet, so treating it as
 *                                      final closes the flow seconds in. The
 *                                      caller applies the same 2-minute grace
 *                                      the native app uses.
 */
export const verifyPayment = (reference: string) =>
  apiFetch<{ status?: string; amount?: number; authorizationUrl?: string; error?: string }>(
    `/api/payments/verify?reference=${encodeURIComponent(reference)}`
  );

/** South African banks with their codes (the code doubles as the branch code). */
export const getBanks = () => apiFetch<Bank[]>("/api/payments/banks");

// ── Affiliate / referrals — the "Invite & earn" section ──────────────────────
// Same contracts the React Native app used (services/AffiliateService.ts), so an
// affiliate registered from either build is the same affiliate:

export type AffiliateSummary = {
  id?: string;
  referral_code?: string | null;
  code?: string | null;
  status?: string | null;
  balance?: number | string | null;
  total_earned?: number | string | null;
  total_referrals?: number | null;
  created_at?: string | null;
};

export type AffiliateReferral = {
  id: string;
  referred_name?: string | null;
  status?: string | null;
  rewarded_amount?: number | string | null;
  created_at?: string | null;
};

export type AffiliateTransaction = {
  id: string;
  amount?: number | string | null;
  kind?: string | null;
  status?: string | null;
  note?: string | null;
  created_at?: string | null;
};

export const registerAffiliate = () =>
  apiFetch<{ affiliate: AffiliateSummary }>("/api/affiliates/register", { method: "POST" });

export const getAffiliateSummary = () =>
  apiFetch<{ affiliate: AffiliateSummary | null }>("/api/affiliates/me");

export const getAffiliateReferrals = () =>
  apiFetch<{ referrals: AffiliateReferral[] }>("/api/affiliates/me/referrals");

export const getAffiliateTransactions = () =>
  apiFetch<{ transactions: AffiliateTransaction[] }>("/api/affiliates/me/transactions");

/** Claims someone else's invite code for this account. */
export const claimReferralCode = (code: string) =>
  apiFetch<{ success?: boolean; alreadyReferred?: boolean; error?: string }>(
    "/api/affiliates/claim",
    { method: "POST", body: JSON.stringify({ code }) }
  );

/**
 * Saves the rider's own details. This is the SAME upsert the app runs at launch
 * (POST /api/users/sync) — `role` is deliberately NOT sent, so a driver account
 * can never be downgraded to passenger by this screen.
 */
export const updateMyProfile = (input: { full_name?: string; phone?: string }) =>
  apiFetch<{ user?: AuthUser["dbUser"] }>("/api/users/sync", {
    method: "POST",
    body: JSON.stringify(input),
  });

/**
 * Opens a URL outside the WebView.
 *
 * Card checkout needs a real browser: the Paystack page returns
 * `x-frame-options: SAMEORIGIN` (verified live), so an iframe renders blank, and
 * 3-D Secure / OTP cannot complete in an embedded view either. Capacitor's
 * Browser plugin opens a Custom Tab on top of the app; on a plain web build this
 * falls back to a new tab.
 */
export async function openExternalUrl(url: string) {
  if (!url) return;
  try {
    const { Browser } = await import("@capacitor/browser");
    await Browser.open({ url });
    return;
  } catch {
    /* plugin unavailable (web build) — fall through */
  }
  const w = window.open(url, "_blank");
  if (w) return;
  const a = document.createElement("a");
  a.href = url;
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/**
 * Attempts a real payout. Returns null when the server has no payouts route
 * (which is the case on this deployment), so the caller can queue it locally
 * and say so honestly instead of faking success.
 */
export async function requestPayout(input: {
  bankCode: string;
  accountNumber: string;
  bankName: string;
  amount: number;
}): Promise<{ ok: boolean; reference?: string; message: string; unavailable: boolean }> {
  try {
    const resolved = await apiFetch<{ success: boolean; recipient_code?: string }>(
      "/api/payouts/resolve",
      {
        method: "POST",
        body: JSON.stringify({ bankCode: input.bankCode, accountNumber: input.accountNumber }),
      }
    );
    const result = await apiFetch<{ success: boolean; reference?: string; message?: string }>(
      "/api/payouts/request",
      {
        method: "POST",
        body: JSON.stringify({
          bankCode: input.bankCode,
          accountNumber: input.accountNumber,
          bankName: input.bankName,
          amount: input.amount,
          recipientCode: resolved?.recipient_code || undefined,
        }),
      }
    );
    return {
      ok: !!result?.success,
      reference: result?.reference,
      message: result?.message || "Withdrawal submitted",
      unavailable: false,
    };
  } catch (e: any) {
    // 404 = the payouts API is not deployed here. Anything else is a real error.
    const unavailable = e?.status === 404;
    return {
      ok: false,
      message: unavailable
        ? "Withdrawals are being finalised — your request has been saved."
        : e?.message || "Could not complete the withdrawal",
      unavailable,
    };
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// RIDER APP
//
// Ported from the React Native rider app (vura-rider):
//   services/RideService.ts      ride history, active ride, receipt, rating
//   services/SearchService.ts    place search
//   services/SafetyService.ts    trusted contacts, safety events, SOS
//   services/DisputeService.ts   disputes (+ lost item goes through here)
//   services/SchedulingService.ts scheduled rides
//   services/TipService.ts       tips
//   lib/socket.ts                booking, cancel, chat, fare split, tracking
//
// Every endpoint below was confirmed to EXIST on the live server first
// (figma-ui/_probe.mjs + _probe2.mjs, unauthenticated so nothing was written):
//
//   EXISTS  GET  /api/rides/me/active          GET  /api/rides/history
//           GET  /api/search/geocode            GET  /api/drivers/nearby (public)
//           GET  /api/payments/methods          GET  /api/payments/banks
//           GET  /api/safety/contacts           POST /api/safety/sos
//           GET  /api/safety/events             GET+POST /api/disputes
//           GET  /api/rides/scheduled           POST /api/rides/schedule
//           POST /api/ratings                   POST /api/tips
//           socket: passenger:ride:request / cancel / chat / split / safety
//
//   ABSENT  /api/pay-later*, /api/promotions, /api/affiliate*, /api/lost-items,
//           /api/notifications, /api/saved-places, /api/payments/topup|charge
//           -> those screens either read from the device (as the old app did for
//              saved places) or report honestly that the server route is missing.
// ═════════════════════════════════════════════════════════════════════════════

export type RiderActiveRide = {
  id: string;
  status: "searching" | "accepted" | "driver_arrived" | "in_progress" | "completed" | "cancelled";
  pickup_address?: string | null;
  pickup_lat?: number | null;
  pickup_lng?: number | null;
  destination_address?: string | null;
  destination_lat?: number | null;
  destination_lng?: number | null;
  estimated_fare?: number | string | null;
  actual_fare?: number | string | null;
  distance_km?: number | null;
  duration_mins?: number | null;
  driver_name?: string | null;
  driver_vehicle?: string | null;
  driver_plate?: string | null;
  driver_rating?: number | null;
  driver_lat?: number | null;
  driver_lng?: number | null;
  driver_heading?: number | null;
  passenger_name?: string | null;
  payment_method?: string | null;
  created_at?: string;
};

/** GET /api/rides/me/active — the ride in progress, if any. */
export const getActiveRide = () =>
  apiFetch<{ ride: RiderActiveRide | null }>("/api/rides/me/active").then((r) => r?.ride ?? null);

/** GET /api/rides/history — this rider's completed rides. */
export const getRideHistory = (page = 1, limit = 20) =>
  apiFetch<{ rides: any[]; pagination?: any }>(
    `/api/rides/history?page=${page}&limit=${limit}`
  ).then((r) => ({ rides: r?.rides || [], pagination: r?.pagination }));

export const getRideById = (id: string) =>
  apiFetch<{ ride: any }>(`/api/rides/${id}`).then((r) => r?.ride ?? null);

export const getRideReceipt = (rideId: string) =>
  apiFetch<{ receipt: any }>(`/api/rides/${rideId}/receipt`).then((r) => r?.receipt ?? null);

/** POST /api/ratings */
export const submitRating = (rideId: string, score: number, comment?: string) =>
  apiFetch("/api/ratings", {
    method: "POST",
    body: JSON.stringify({ rideId, score, comment }),
  });

/** PATCH /api/rides/:id/pickup — move the pin before the driver arrives. */
export const updateRidePickup = (rideId: string, address: string, lat: number, lng: number) =>
  apiFetch<{ success: boolean }>(`/api/rides/${rideId}/pickup`, {
    method: "PATCH",
    body: JSON.stringify({ address, lat, lng }),
  });

// ── Booking over the socket ──────────────────────────────────────────────────
// The rider books by EMITTING, not by POSTing — the same as the native app
// (lib/socket.ts: "passenger:ride:request"). The server answers with one of:
//   ride:requested:ack  { success, rideId?, reason?, message? }
//   ride:no:drivers
//   ride:expired
// So the helper resolves with whichever arrives first, or times out.

export type RideRequestInput = {
  pickupAddress: string;
  pickupLat: number;
  pickupLng: number;
  destinationAddress: string;
  destinationLat: number;
  destinationLng: number;
  waypoints?: { address: string; lat: number; lng: number }[];
  tier?: string;
  scheduledAt?: string | null;
  paymentMethod?: string;
  fare?: number;
  deviceId?: string;
};

export type RideRequestResult =
  | { ok: true; rideId: string }
  | { ok: false; reason: "no_drivers" | "expired" | "error" | "timeout"; message: string };

export async function requestRide(input: RideRequestInput): Promise<RideRequestResult> {
  const s = await getSocket();
  return new Promise<RideRequestResult>((resolve) => {
    let settled = false;
    const done = (r: RideRequestResult) => {
      if (settled) return;
      settled = true;
      off();
      clearTimeout(timer);
      resolve(r);
    };
    const off = (() => {
      const a = on("ride:requested:ack", (d: any) =>
        d?.success
          ? done({ ok: true, rideId: String(d.rideId) })
          : done({ ok: false, reason: "error", message: d?.reason || d?.message || "Could not book the ride" })
      );
      const b = on("ride:no:drivers", () =>
        done({ ok: false, reason: "no_drivers", message: "No drivers nearby right now. Try again shortly." })
      );
      const c = on("ride:expired", () =>
        done({ ok: false, reason: "expired", message: "That request timed out." })
      );
      return () => { a(); b(); c(); };
    })();
    const timer = setTimeout(
      () => done({ ok: false, reason: "timeout", message: "No response from the server. Check your connection." }),
      45000
    );

    s.emit("passenger:ride:request", {
      pickupAddress: input.pickupAddress,
      pickupLat: input.pickupLat,
      pickupLng: input.pickupLng,
      destinationAddress: input.destinationAddress,
      destinationLat: input.destinationLat,
      destinationLng: input.destinationLng,
      waypoints: input.waypoints || [],
      tier: input.tier || "go",
      scheduledAt: input.scheduledAt || undefined,
      paymentMethod: input.paymentMethod || "cash",
      fare: input.fare,
      deviceId: input.deviceId || deviceId(),
    });
  });
}

/** The rider cancels an active ride. */
export async function cancelRide(rideId: string, reason: string) {
  const s = await getSocket();
  s.emit("passenger:ride:cancel", { rideId, reason });
}

/** Move the pickup pin (socket form) — mirrors passenger:ride:update_pickup. */
export async function socketUpdatePickup(rideId: string, address: string, lat: number, lng: number) {
  const s = await getSocket();
  s.emit("passenger:ride:update_pickup", { rideId, address, lat, lng });
}

/** Tell the server we're connected and listening for ride updates. */
export async function passengerConnect() {
  const s = await getSocket();
  s.emit("passenger:connect");
}

// ── Chat with the driver (socket) ────────────────────────────────────────────
export async function chatJoin(rideId: string) {
  const s = await getSocket();
  s.emit("chat:join", { rideId });
}
export async function chatLeave(rideId: string) {
  const s = await getSocket();
  s.emit("chat:leave", { rideId });
}
export async function chatSend(rideId: string, message: string) {
  const s = await getSocket();
  s.emit("chat:send", { rideId, message });
}

// ── Fare split (socket) ──────────────────────────────────────────────────────
export async function splitInvite(rideId: string, inviteeEmail: string, amount: number) {
  const s = await getSocket();
  s.emit("split:invite", { rideId, inviteeEmail, amount });
}
export async function splitRespond(splitId: string, accept: boolean) {
  const s = await getSocket();
  s.emit("split:respond", { splitId, accept });
}

// ── Safety (socket + REST) ───────────────────────────────────────────────────
export async function triggerSos(rideId: string) {
  const s = await getSocket();
  s.emit("safety:sos", { rideId });
}
export async function rideCheckOk(rideId: string) {
  const s = await getSocket();
  s.emit("safety:ridecheck:ok", { rideId });
}
export async function shareTrip(rideId: string) {
  const s = await getSocket();
  s.emit("share:generate", { rideId });
}

// ── Device id ────────────────────────────────────────────────────────────────
// The native app sends a stable deviceId with each booking (lib/device.ts, kept
// in AsyncStorage). Rides carry a device_id column — the driver app uses it to
// remember which device announced a ride — so the rider must send one too.
// The web equivalent of AsyncStorage is localStorage, under the same idea.
const DEVICE_KEY = "vura.device.id";

export function deviceId(): string {
  try {
    const existing = localStorage.getItem(DEVICE_KEY);
    if (existing) return existing;
    const fresh =
      "web-" +
      Date.now().toString(36) +
      "-" +
      Math.random().toString(36).slice(2, 10);
    localStorage.setItem(DEVICE_KEY, fresh);
    return fresh;
  } catch {
    return "web-unknown";
  }
}

// ── Search ───────────────────────────────────────────────────────────────────
// Ported from the old rider's app/search.tsx. The accuracy comes from the
// PARAMETERS, not the endpoint: the old app biases results to the rider's
// position, asks for closest-first and confines results to South Africa.
//
//   GET /api/search/geocode?q=&lat=&lng=&limit=10&sort=distance&country=ZAF
//     -> { provider, items: [{ name, address, lat, lng, resultType, distance }], queryTerms }
//
// My first version sent only ?q=, which is why results were vaguer and slower to
// be useful than the old app. The server's own ranking is kept as-is (never
// re-sorted or de-duplicated, exactly as the old comment insisted).
export type Place = {
  id?: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  distance?: number;
  resultType?: string;
};

/** Bias + ranking parameters, identical to the old search screen. */
function geoParams(q: string, bias?: { lat: number; lng: number } | null, limit = 10) {
  const p = new URLSearchParams({ q })
  if (bias) {
    p.set('lat', String(bias.lat))
    p.set('lng', String(bias.lng))
  }
  p.set('limit', String(limit))
  // Closest match first, and never a place outside South Africa.
  p.set('sort', 'distance')
  p.set('country', 'ZAF')
  return p.toString()
}

export async function searchPlaces(
  query: string,
  bias?: { lat: number; lng: number } | null
): Promise<Place[]> {
  const q = query.trim()
  if (!q) return []
  const res = await apiFetch<any>(`/api/search/geocode?${geoParams(q, bias)}`)
  const rows: any[] = Array.isArray(res?.items) ? res.items : []
  // Consume in the provider's order — do not re-sort or de-duplicate.
  return rows
    .map((r) => ({
      id: r?.id,
      name: r?.name || r?.title || r?.address || 'Place',
      address: r?.address || '',
      lat: Number(r?.lat),
      lng: Number(r?.lng),
      distance: r?.distance,
      resultType: r?.resultType,
    }))
    .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng))
}

/** Nearby / discoverable places around a point — GET /api/search/discover. */
export async function discoverPlaces(
  q: string,
  bias: { lat: number; lng: number },
  limit = 12
): Promise<Place[]> {
  const p = new URLSearchParams({ q })
  p.set('lat', String(bias.lat))
  p.set('lng', String(bias.lng))
  p.set('limit', String(limit))
  const res = await apiFetch<any>(`/api/search/discover?${p.toString()}`)
  const rows: any[] = Array.isArray(res?.items) ? res.items : []
  return rows
    .map((r) => ({
      id: r?.id,
      name: r?.name || 'Place',
      address: r?.address || '',
      lat: Number(r?.lat),
      lng: Number(r?.lng),
      distance: r?.distance,
    }))
    .filter((p2) => Number.isFinite(p2.lat) && Number.isFinite(p2.lng))
}

/** Turn a coordinate into an address — GET /api/search/reverse. */
export async function reverseGeocode(lat: number, lng: number) {
  return apiFetch<{ name: string; address: string }>(
    `/api/search/reverse?lat=${lat}&lng=${lng}`
  );
}

// ── Recent searches ──────────────────────────────────────────────────────────
// GET/POST/DELETE /api/searches, with the device as a fallback — the same
// best-effort pattern the old SearchService used (server first, then
// AsyncStorage; here localStorage is the web equivalent).
const RECENT_KEY = 'vura.searches.recent'

export type RecentSearch = {
  id: string
  name: string
  addr: string
  lat: number
  lng: number
  created_at: string
}

function readLocalSearches(): RecentSearch[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY)
    return raw ? (JSON.parse(raw) as RecentSearch[]) : []
  } catch {
    return []
  }
}

export async function getRecentSearches(): Promise<RecentSearch[]> {
  try {
    const data = await apiFetch<{ searches: RecentSearch[] }>('/api/searches')
    if (Array.isArray(data?.searches)) {
      try { localStorage.setItem(RECENT_KEY, JSON.stringify(data.searches)) } catch { /* ignore */ }
      return data.searches
    }
  } catch {
    /* fall back to the device copy */
  }
  return readLocalSearches()
}

export async function saveSearch(search: {
  name: string
  addr: string
  lat: number
  lng: number
}): Promise<void> {
  const payload = {
    name: search.name,
    address: search.addr,
    lat: search.lat,
    lng: search.lng,
  }
  try {
    await apiFetch('/api/searches', { method: 'POST', body: JSON.stringify(payload) })
  } catch {
    /* backend sync is best-effort */
  }

  const entry: RecentSearch = {
    id: String(Date.now()),
    name: String(search.name || '').slice(0, 120),
    addr: String(search.addr || '').slice(0, 180),
    lat: search.lat,
    lng: search.lng,
    created_at: new Date().toISOString(),
  }
  const next = [entry, ...readLocalSearches().filter((s) => s.name !== entry.name)].slice(0, 10)
  // The tile cache shares this storage, so never let a quota error crash the app.
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next))
  } catch {
    try { localStorage.setItem(RECENT_KEY, JSON.stringify(next.slice(0, 5))) } catch {
      try { localStorage.removeItem(RECENT_KEY) } catch { /* ignore */ }
    }
  }
}

export async function clearRecentSearches(): Promise<void> {
  try {
    await apiFetch('/api/searches', { method: 'DELETE' })
  } catch {
    /* best-effort */
  }
  try { localStorage.removeItem(RECENT_KEY) } catch { /* ignore */ }
}

/** GET /api/drivers/nearby — public; used to show cars around the rider. */
export const getNearbyDrivers = (lat: number, lng: number, radius = 5) =>
  apiFetch<{ drivers: any[] }>(
    `/api/drivers/nearby?lat=${lat}&lng=${lng}&radius=${radius}`
  ).then((r) => r?.drivers || []);

// ── Safety ───────────────────────────────────────────────────────────────────
// CONTRACT VERIFIED LIVE (_safety2.mjs, throwaway rider):
//   GET    /api/safety/contacts     -> 200 { contacts: [] }
//   POST   /api/safety/contacts     -> 201 { id, name, phone, relationship }
//          (the created contact comes back FLAT — not wrapped in { contact })
//   DELETE /api/safety/contacts/:id -> 200 { success: true }, then gone from GET
//   POST   /api/safety/sos          -> route exists (validates rideId)
//   POST   /api/safety/share        -> route exists (validates rideId)
//   POST   /api/safety/share/stop   -> route exists (validates rideId)
// The native app also ORs in socket events ("safety:sos", "share:generate") —
// see triggerSos()/shareTrip() below; the REST calls are what the server records.
export type EmergencyContact = {
  id?: string;
  name: string;
  phone: string;
  relationship: string;
};

export const getEmergencyContacts = () =>
  apiFetch<{ contacts: EmergencyContact[] }>("/api/safety/contacts").then((r) => r?.contacts || []);

/** Adds a trusted contact. The server answers with the stored row (flat). */
export const addEmergencyContact = (c: EmergencyContact) =>
  apiFetch<EmergencyContact>("/api/safety/contacts", {
    method: "POST",
    body: JSON.stringify({
      name: c.name,
      phone: c.phone,
      relationship: c.relationship || "Other",
    }),
  });

export const deleteEmergencyContact = (id: string) =>
  apiFetch<{ success: boolean }>(`/api/safety/contacts/${id}`, { method: "DELETE" });

/**
 * POST /api/safety/sos — records the emergency and alerts the rider's trusted
 * contacts. Paired with the "safety:sos" socket event (triggerSos below) the
 * same way the native app does it, so the driver/ops side sees it live too.
 */
export const sosRest = (rideId: string) =>
  apiFetch("/api/safety/sos", { method: "POST", body: JSON.stringify({ rideId }) });

/**
 * POST /api/safety/share — the server mints the public tracking link the rider
 * can hand to friends/family. Answers { shareToken, shareUrl }.
 */
export const shareTripLink = (rideId: string) =>
  apiFetch<{ shareToken?: string; shareUrl?: string }>("/api/safety/share", {
    method: "POST",
    body: JSON.stringify({ rideId }),
  });

/** POST /api/safety/share/stop — turns the live tracking link off again. */
export const stopSharingTrip = (rideId: string) =>
  apiFetch("/api/safety/share/stop", { method: "POST", body: JSON.stringify({ rideId }) });

/**
 * GET /api/safety/events is NOT a route on the live server (probe: GET 404,
 * POST 401 — only the server-side writer exists), so the Safety screen shows
 * the ride's live state instead of an events feed. Kept for completeness only.
 */
export const getSafetyEvents = () =>
  apiFetch<{ events: any[] }>("/api/safety/events").then((r) => r?.events || []);

// ── Disputes (also used for lost items, as the native app does) ──────────────
// CONTRACT VERIFIED LIVE (_safety2.mjs):
//   GET  /api/disputes -> 200 { disputes: [] }
//   POST /api/disputes -> 201 { dispute: { id, ride_id, type, reason,
//                          description, status:"open", created_at } }
//          rideId is OPTIONAL: a dispute posted without one comes back with
//          ride_id: null, so "Report an Issue" works from the account tab too.
//   GET  /api/disputes/lost-items -> 200 { reports: [] }
//   POST /api/disputes/lost-item  -> route exists ({rideId,itemName,itemDescription})
export type DisputeInput = {
  rideId?: string;
  type: "cancellation_fee" | "refund" | "rating" | "lost_item" | "other";
  reason: string;
  description: string;
};

export const createDispute = (d: DisputeInput) =>
  apiFetch<{ dispute: any }>("/api/disputes", {
    method: "POST",
    body: JSON.stringify({
      rideId: d.rideId || undefined,
      type: d.type,
      reason: d.reason || d.type,
      description: d.description,
    }),
  });

export const getDisputes = () =>
  apiFetch<{ disputes: any[] }>("/api/disputes").then((r) => r?.disputes || []);

/** POST /api/disputes/lost-item — the native app's app/lost-item.tsx path. */
export const reportLostItem = (input: { rideId: string; itemName: string; itemDescription: string }) =>
  apiFetch("/api/disputes/lost-item", { method: "POST", body: JSON.stringify(input) });

export const getLostItemReports = () =>
  apiFetch<{ reports: any[] }>("/api/disputes/lost-items").then((r) => r?.reports || []);

// ── Scheduled rides ──────────────────────────────────────────────────────────
// GET /api/rides/scheduled + POST /api/rides/schedule (both confirmed live).
// FULL LIFECYCLE VERIFIED LIVE (_safety2.mjs): POST /api/rides/schedule -> 201
// { ride } with the requested scheduled_at/status "scheduled"; the ride then
// appears in GET /api/rides/scheduled with pickup/destination addresses,
// scheduled_at, tier, waypoints and (once assigned) driver_name/driver_phone/
// vehicle_*/license_plate; cancelling removes it from that list.
export const getScheduledRides = () =>
  apiFetch<{ rides: any[] }>("/api/rides/scheduled").then((r) => r?.rides || []);

export const scheduleRide = (input: {
  pickupAddress: string;
  pickupLat: number;
  pickupLng: number;
  destinationAddress: string;
  destinationLat: number;
  destinationLng: number;
  scheduledAt: string;
  tier?: string;
  /** Stops between pickup and drop-off, same shape the booking flow sends. */
  waypoints?: { address: string; lat: number; lng: number }[];
}) =>
  apiFetch<{ ride: any }>("/api/rides/schedule", {
    method: "POST",
    body: JSON.stringify({ ...input, tier: input.tier || "go" }),
  });

/**
 * Cancels a booked-ahead trip. CONTRACT VERIFIED LIVE (_route.mjs):
 *   POST /api/rides/scheduled/{id}/cancel -> 200 { success:true, cancellation_fee:0 }
 * and the ride then disappears from GET /api/rides/scheduled.
 * The neighbouring guesses were checked and are NOT routes on this server:
 *   POST /api/rides/{id}/cancel    -> 404
 *   POST /api/rides/{id}/status    -> 404
 */
export const cancelScheduledRide = (id: string) =>
  apiFetch<{ success: boolean; cancellation_fee?: number }>(
    `/api/rides/scheduled/${id}/cancel`,
    { method: "POST" }
  );

// ── Tip the driver ───────────────────────────────────────────────────────────
// POST /api/tips — verified reachable live (_safety2.mjs; it validates rideId,
// exercising the route with a fake id returns the server's own uuid error, not
// an Express 404). The native app's TipService also sends the card the tip is
// charged to when the ride itself was paid in cash.
export const sendTip = (rideId: string, amount: number, paymentMethodId?: string) =>
  apiFetch("/api/tips", {
    method: "POST",
    body: JSON.stringify({ rideId, amount, ...(paymentMethodId ? { paymentMethodId } : {}) }),
  });

// ── Notifications ────────────────────────────────────────────────────────────
// Both endpoints verified working against the live server (_flow.mjs):
//   GET /api/notifications/history  -> 200 { notifications: [] }
//   POST /api/notifications/register -> 200 { success: true }
export type NotificationRow = {
  id: string;
  title?: string;
  body?: string;
  type?: string;
  created_at?: string;
  read?: boolean;
  data?: any;
};

export const getNotifications = () =>
  apiFetch<{ notifications: NotificationRow[] }>("/api/notifications/history")
    .then((r) => r?.notifications || []);

/**
 * Registers this device for push. The native app sends the Expo push token from
 * expo-notifications; a WebView has no direct equivalent without a push plugin,
 * so this registers the installed app + device id and records what was sent.
 * The call itself is the same one the native app makes.
 */
export const registerNotificationToken = (token: string, platform = "android") =>
  apiFetch<{ success: boolean }>("/api/notifications/register", {
    method: "POST",
    body: JSON.stringify({ token, platform }),
  });

// ── Route (polyline between two points) ──────────────────────────────────────
// GET /api/route — the server proxies/caches the routing engine (lib/route.ts in
// the native apps). Returns points the map can draw.
//
// CONTRACT VERIFIED LIVE (_route.mjs):
//   GET /api/route?points=lng,lat;lng,lat
//     -> 200 { cached:false, routes:[{ geometry:{ coordinates:[[lng,lat],…] } }] }
// The call this function made before — `?fromLat=&fromLng=&toLat=&toLng=` — is
// answered with:
//   400 {"error":"points must be in 'lng,lat;lng,lat' format"}
// so the polyline could never be drawn. Coordinates come back as GeoJSON
// [lng, lat] pairs, which is why they are swapped on the way out. Passing the
// stops as `via` draws the real door-to-door route, not the direct line.
export async function getRoute(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
  via: { lat: number; lng: number }[] = []
): Promise<{ lat: number; lng: number }[]> {
  const points = [from, ...via, to]
    .map((p) => `${Number(p.lng)},${Number(p.lat)}`)
    .join(";");
  const res = await apiFetch<any>(`/api/route?points=${points}`);
  const pts: any[] =
    res?.routes?.[0]?.geometry?.coordinates ||
    res?.points ||
    res?.route ||
    res?.coordinates ||
    [];
  return pts
    .map((p) => Array.isArray(p)
      ? { lat: Number(p[1]), lng: Number(p[0]) }
      : { lat: Number(p.lat ?? p.latitude), lng: Number(p.lng ?? p.longitude) })
    .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
}

// ── Saved places (device-only, exactly like the native app) ──────────────────
// The live server has NO /api/saved-places route (confirmed by probe), and the
// native app's app/saved-places.tsx stores them in AsyncStorage only — so this
// mirrors that rather than inventing an endpoint.
const PLACES_KEY = "vura.saved.places";

export type SavedPlace = {
  id: string;
  label: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
};

export function getSavedPlaces(): SavedPlace[] {
  try {
    const raw = localStorage.getItem(PLACES_KEY);
    return raw ? (JSON.parse(raw) as SavedPlace[]) : [];
  } catch {
    return [];
  }
}

export function saveSavedPlaces(rows: SavedPlace[]) {
  try {
    localStorage.setItem(PLACES_KEY, JSON.stringify(rows));
  } catch {
    /* storage unavailable */
  }
}

// ── Documents ────────────────────────────────────────────────────────────────
// Kept because the shared App also renders the driver screens; the endpoints
// are the same ones the native driver app uses.
export type DocumentType =
  | "drivers_license"
  | "id_document"
  | "prdp"
  | "criminal_record"
  | "license_disk"
  | "carscan_report"
  | "vehicle_scan";

export type DocRow = {
  id: string;
  doc_type: DocumentType;
  file_name: string;
  mime_type: string;
  status: string;
  note: string | null;
  created_at: string;
};

export const DOC_LABELS: Record<DocumentType, string> = {
  drivers_license: "Driver's License",
  id_document: "ID Document",
  prdp: "PrDP",
  criminal_record: "Criminal Record",
  license_disk: "License Disk",
  carscan_report: "CarScan Report",
  vehicle_scan: "Vehicle Scan",
};

export const getMyDocuments = () =>
  apiFetch<{ documents: DocRow[] }>("/api/documents/mine");

/**
 * Uploads a document — identical call to the native app's uploadDocumentToS3().
 */
export function uploadDocument(
  type: DocumentType,
  fileName: string,
  mimeType: string,
  data: string
) {
  return apiFetch<{ document: { id: string; status: string } }>("/api/documents/upload", {
    method: "POST",
    body: JSON.stringify({ type, fileName, mimeType, data }),
  });
}

/**
 * Sends the signup verification code by email (Resend, server-side).
 * Identical to the native app's sendVerificationEmail().
 */
export async function sendVerificationEmail(email: string, code: string) {
  try {
    const res = await httpFetch(`${API_URL}/api/email/send-verification`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, code }),
    });
    const data: any = res.text ? (() => { try { return JSON.parse(res.text); } catch { return {}; } })() : {};
    return data.success
      ? { success: true as const }
      : { success: false as const, error: data.error || "Failed to send email" };
  } catch (err: any) {
    return { success: false as const, error: err?.message || "Network error" };
  }
}
