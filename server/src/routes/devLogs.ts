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

const WRITE_KEY = process.env.DEV_LOG_WRITE_KEY || "vura-devlog-key";
const READ_KEY = process.env.DEV_LOG_READ_KEY || WRITE_KEY;

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

router.post("/", async (req: Request, res: Response) => {
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