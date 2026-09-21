import AsyncStorage from "@react-native-async-storage/async-storage";
import { getApiUrl } from "./config";
import { getDeviceId } from "./device";

// ── Remote device logging ─────────────────────────────────────────────────────
// Every interesting event (payments, ride state changes, API failures, socket
// events, uncaught console errors) is buffered on the device and batch-POSTed
// to `POST /api/dev/logs` on our server. The LOCAL log viewer
// (tools/dev-log-viewer/logs.html) polls `GET /api/dev/logs` and shows both
// rider + driver phones live — no USB cable needed.
//
// Design notes:
//  - Fire-and-forget: logging NEVER blocks or crashes the app flow.
//  - Batching: a flush timer drains the buffer every ~2s, so even high-volume
//    debugging produces only a handful of HTTP requests.
//  - Survivability: events also persist to AsyncStorage so logs written while
//    offline are pushed the next time the app is online.
//  - The console.log/info/warn/error hooks forward useful lines (rides,
//    payment, socket, verify, errors) automatically for full visibility.

const APP_MARKER = "rider"; // driver app uses "driver"
const WRITE_KEY = process.env.EXPO_PUBLIC_DEV_LOG_KEY || "vura-devlog-key";

const PENDING_KEY = "vura.devlog.pending";
const MAX_BUFFER = 400;

export type LogLevel = "info" | "warn" | "error" | "event";

type LogEntry = {
  app: string;
  devId: string;
  level: LogLevel;
  tag: string;
  message: string;
  data?: unknown;
  ts: string;
};

let devIdPromise: Promise<string> | null = null;
let buffer: LogEntry[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let flushing = false;
const consoleHooked: { [k: string]: boolean } = {};

function getDevId(): Promise<string> {
  if (!devIdPromise) devIdPromise = getDeviceId().catch(() => "unknown");
  return devIdPromise;
}

function truncate(v: string, max: number): string {
  return v.length > max ? v.slice(0, max) : v;
}

// Safely stringify arbitrary payloads (no circular references, no throwing).
export function stringifyForLog(data: unknown): unknown {
  if (data == null) return null;
  if (typeof data === "string") return truncate(data, 1500);
  if (typeof data === "number" || typeof data === "boolean") return data;
  if (data instanceof Error) {
    return {
      type: data.constructor?.name || "Error",
      message: truncate(data.message || "", 1500),
      stack: truncate(data.stack || "", 3000),
    };
  }
  try {
    const json = JSON.stringify(data, (k, v) => (v instanceof Error ? { message: v.message, stack: v.stack } : v));
    const safe = truncate(json || "", 4000);
    try {
      return JSON.parse(safe);
    } catch {
      return safe;
    }
  } catch {
    return truncate(String(data), 1500);
  }
}

/** Queue a structured log line. Returns immediately; I/O happens in the background. */
export function devLog(level: LogLevel, tag: string, message: string, data?: unknown) {
  try {
    void getDevId().then((devId) => {
      const entry: LogEntry = {
        app: APP_MARKER,
        devId,
        level,
        tag: truncate(tag, 120),
        message: truncate(message, 1000),
        data: stringifyForLog(data),
        ts: new Date().toISOString(),
      };
      buffer.push(entry);
      if (buffer.length > MAX_BUFFER) buffer = buffer.slice(-MAX_BUFFER);
      void persistPending();
      scheduleFlush();
    });
  } catch {
    // never throw from logging
  }
}
// ── Persistence (survive restarts / offline windows) ──────────────────────────

async function persistPending() {
  try {
    await AsyncStorage.setItem(PENDING_KEY, JSON.stringify({ pending: buffer, updated: Date.now() }));
  } catch {}
}

async function loadPending() {
  try {
    const raw = await AsyncStorage.getItem(PENDING_KEY);
    const now = Date.now();
    if (raw) {
      const parsed = JSON.parse(raw);
      const pending: LogEntry[] = Array.isArray(parsed?.pending) ? parsed.pending : [];
      const updated = typeof parsed?.updated === "number" ? parsed.updated : 0;
      // Only restore buffers written in the last 6 hours — anything older is
      // stale and we don't want to re-play old crashes after a reboot.
      if (now - updated < 6 * 3600 * 1000) {
        buffer = [...pending.slice(-MAX_BUFFER), ...buffer].slice(-MAX_BUFFER);
      }
    }
  } catch {}
}

// ── Batching flush ────────────────────────────────────────────────────────────

function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flush();
  }, 2000);
}

async function flush() {
  if (flushing) return;
  if (buffer.length === 0) return;
  flushing = true;
  try {
    const batch = buffer.splice(0, Math.min(buffer.length, 60));
    const ok = await sendBatch(batch);
    if (!ok) {
      // put them back (cap to avoid unbounded growth)
      buffer = [...batch, ...buffer].slice(-MAX_BUFFER);
      void persistPending();
      if (!flushTimer) {
        flushTimer = setTimeout(() => {
          flushTimer = null;
          void flush();
        }, 5000);
      }
    } else {
      void persistPending();
    }
  } catch {
    // network down — entries stay in `buffer` + AsyncStorage
  } finally {
    flushing = false;
  }
}

export async function flushNow() {
  await loadPending();
  await flush();
}

async function sendBatch(batch: LogEntry[]): Promise<boolean> {
  const url = getApiUrl("/api/dev/logs");
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-dev-log-key": WRITE_KEY,
        },
        body: JSON.stringify({ entries: batch }),
        signal: controller.signal,
      });
      return res.status === 204 || res.status === 200;
    } finally {
      clearTimeout(timeoutId);
    }
  } catch {
    return false;
  }
}

// ── Console hooks: capture stray errors / warnings automatically ──────────────

const INTERESTING = [
  "ride", "payment", "paystack", "verify", "3ds", "3-ds", "abandon",
  "refund", "wallet", "card", "register", "socket", "connect", "upload",
  "document", "vehicle", "error", "fail", "exception", "catch",
];

function shouldCapture(text: string, level: LogLevel): boolean {
  const lower = text.toLowerCase();
  if (level === "error") return true;
  if (level === "warn") return true;
  return INTERESTING.some((k) => lower.includes(k));
}

/**
 * Wraps console.log/info/warn/error so interesting lines also land in the log
 * sink. Errors always forward; info lines only when they mention rides,
 * payments, sockets, uploads etc. — keeps the noise out while catching the
 * important stuff. Safe to call multiple times.
 */
export function hookConsole() {
  const levels: { name: string; level: LogLevel; orig: (...args: any[]) => void }[] = [
    { name: "log", level: "info", orig: console.log },
    { name: "info", level: "info", orig: console.info },
    { name: "warn", level: "warn", orig: console.warn },
    { name: "error", level: "error", orig: console.error },
  ];
  for (const item of levels) {
    if (consoleHooked[item.name]) continue;
    consoleHooked[item.name] = true;
    // eslint-disable-next-line no-console
    (console as any)[item.name] = (...args: any[]) => {
      try {
        item.orig.apply(console, args);
      } catch {}
      try {
        const text = args.map((a) => (typeof a === "string" ? a : safeSnippet(a))).join(" ");
        if (!text) return;
        if (!shouldCapture(text, item.level)) return;
        devLog(item.level, "console", text);
      } catch {}
    };
  }
}

function safeSnippet(v: unknown): string {
  try {
    if (typeof v === "string") return v;
    if (v instanceof Error) return `Error: ${v.message}`;
    const s = JSON.stringify(v);
    return s ? truncate(s, 400) : String(v);
  } catch {
    return String(v);
  }
}

/** Convenience one-liners for fire-and-forget audit events. */
export const logEvent = (tag: string, message: string, data?: unknown) =>
  devLog("event", tag, message, data);
export const logError = (tag: string, message: string, data?: unknown) =>
  devLog("error", tag, message, data);
export const logInfo = (tag: string, message: string, data?: unknown) =>
  devLog("info", tag, message, data);