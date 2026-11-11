import { Router, Request, Response } from "express";
import { query, execute } from "../config/database";

// ── Remote device-log sink ─────────────────────────────────────────────────────
//   POST /api/dev/logs   apps batch-fire structured logs here (no auth — the
//                        write key is sent in the `x-dev-log-key` header)
//   GET  /api/dev/logs   the LOCAL log viewer polls this (read key via ?key=);
//                        returns newest-first so the page can diff by id.
//
// This is a debugging aid: it is deliberately un-authenticated so crashed /
// not-logged-in app states can still report. The read key prevents strangers
// from browsing rider/driver device logs. Env overrides:
//   DEV_LOG_WRITE_KEY   (default "vura-devlog-key")
//   DEV_LOG_READ_KEY    (default DEV_LOG_WRITE_KEY)

const configuredWriteKey = String(process.env.DEV_LOG_WRITE_KEY || "").trim();
// In production the key MUST come from the environment. A hard-coded default
// is a public secret the moment an APK is unpacked.
const WRITE_KEY = configuredWriteKey || (process.env.NODE_ENV === "production" ? "" : "vura-devlog-key");
// Exported so the other dev-only routes (see devDiag.ts) share ONE read key instead
// of each re-reading DEV_LOG_READ_KEY and drifting apart.
export const READ_KEY = String(process.env.DEV_LOG_READ_KEY || "").trim() || WRITE_KEY;

const LEVELS = new Set(["info", "warn", "error", "event"]);

// Keep the table from growing forever: only the newest 20000 rows plus the
// last 48h survive. Runs opportunistically on POSTs (cheap, no cron needed).
async function pruneDevLogs() {
  try {
    await execute(
      `DELETE FROM dev_logs
        WHERE id NOT IN (SELECT id FROM dev_logs ORDER BY id DESC LIMIT 20000)
           OR created_at < NOW() - INTERVAL '48 hours'`
    );
  } catch {
    // table may not exist yet on a fresh boot — ignore
  }
}

const router = Router();

/**
 * Public CRASH sink. Deliberately un-authenticated (a crash can happen before
 * login), but tightly limited: only rider/driver, max 5 entries, 2 KB message,
 * 8 KB data, 256 KB body (mounted in index.ts) and a small per-IP limiter.
 * No write key is embedded in any APK anymore.
 */
router.post("/crash", async (req: Request, res: Response) => {
  try {
    const body = req.body || {};
    const app = String(body.app || "").toLowerCase();
    if (app !== "rider" && app !== "driver") {
      res.status(400).json({ error: "invalid app" });
      return;
    }
    const raw = Array.isArray(body.entries) ? body.entries.slice(0, 5) : [body];
    const entries = raw
      .filter((e: any) => e && typeof e === "object")
      .map((e: any) => ({
        app,
        deviceId: String(e.deviceId || "").slice(0, 120),
        level: "error",
        tag: "app-crash",
        message: String(e.message || "").slice(0, 2000),
        data: e.data == null ? null : JSON.stringify(e.data).slice(0, 8000),
      }))
      .filter((e: any) => e.message);
    if (entries.length === 0) {
      res.status(204).end();
      return;
    }
    for (const e of entries) {
      await execute(
        `INSERT INTO dev_logs (app, device_id, level, tag, message, data)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [e.app, e.deviceId, e.level, e.tag, e.message, e.data]
      );
    }
    if (Math.random() < 0.05) void pruneDevLogs();
    res.status(204).end();
  } catch {
    // A crash report must never break the caller.
    res.status(204).end();
  }
});

router.post("/", async (req: Request, res: Response) => {
  if (!WRITE_KEY) {
    res.status(503).json({ error: "log sink disabled" });
    return;
  }
  const key = (req.headers["x-dev-log-key"] || "").toString();
  if (!key || key !== WRITE_KEY) {
    res.status(401).json({ error: "bad log key" });
    return;
  }

  const body = req.body || {};
  // Accept either a single event or a batch { entries: [...] }.
  const entries =
    Array.isArray(body.entries)
      ? body.entries
      : [{ app: body.app, deviceId: body.deviceId, level: body.level, tag: body.tag, message: body.message, data: body.data }];

  const cleaned: any[] = [];
  for (const e of entries) {
    if (!e) continue;
    const level = LEVELS.has(String(e.level)) ? String(e.level) : "info";
    cleaned.push({
      app: String(e.app || "unknown").slice(0, 20),
      deviceId: String(e.deviceId || "").slice(0, 120),
      level,
      tag: String(e.tag || "").slice(0, 120),
      message: String(e.message || "").slice(0, 2000),
      data: e.data == null ? null : JSON.stringify(e.data).slice(0, 8000),
    });
  }
  if (cleaned.length === 0) {
    res.status(400).json({ error: "no entries" });
    return;
  }

  try {
    for (const c of cleaned) {
      await execute(
        `INSERT INTO dev_logs (app, device_id, level, tag, message, data)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [c.app, c.deviceId, c.level, c.tag, c.message, c.data]
      );
    }
    // ~1 in 20 inserts also prunes; keeps load near zero.
    if (Math.random() < 0.05) void pruneDevLogs();
    res.status(204).end();
  } catch (err: any) {
    // Never let the logging path break the app request.
    res.status(500).json({ error: err?.message || "log write failed" });
  }
});

router.get("/", async (req: Request, res: Response) => {
  // The local viewer is opened from a file:// page — allow any origin for the
  // GET so double-clicking logs.html works without a CORS proxy.
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, OPTIONS");

  if (!READ_KEY) {
    res.status(503).json({ error: "log viewer disabled" });
    return;
  }
  const key = String(req.query.key || "");
  if (!key || key !== READ_KEY) {
    res.status(401).json({ error: "bad read key" });
    return;
  }

  const app = String(req.query.app || "all").slice(0, 20);
  const level = String(req.query.level || "").slice(0, 20);
  const limit = Math.min(Math.max(parseInt(String(req.query.limit || "300"), 10) || 300, 1), 1000);
  const afterId = parseInt(String(req.query.after_id || "0"), 10) || 0;

  try {
    const where: string[] = ["dev_logs.id > $1"];
    const params: any[] = [afterId];
    if (app === "rider" || app === "driver") {
      params.push(app);
      where.push(`dev_logs.app = $${params.length}`);
    }
    if (LEVELS.has(level)) {
      params.push(level);
      where.push(`dev_logs.level = $${params.length}`);
    }
    params.push(limit);
    const rows = await query<any>(
      `SELECT dev_logs.id, dev_logs.app, dev_logs.device_id, dev_logs.level,
              dev_logs.tag, dev_logs.message, dev_logs.data, dev_logs.created_at
         FROM dev_logs
        WHERE ${where.join(" AND ")}
        ORDER BY dev_logs.id DESC
        LIMIT $${params.length}`,
      params
    );
    res.json({ logs: rows, serverTime: new Date().toISOString() });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || "log read failed" });
  }
});

router.options("/", (_req: Request, res: Response) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.status(204).end();
});

export default router;