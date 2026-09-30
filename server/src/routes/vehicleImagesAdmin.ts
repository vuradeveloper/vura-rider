// ─────────────────────────────────────────────────────────────────────────────
// vehicleImagesAdmin.ts — everything an operator touches for vehicle photos:
//
//   GET  /api/vehicle-images/<file>.webp        public: our own stored copy
//   GET  /api/admin/vehicle-images              password page: pending/review
//   POST /api/admin/vehicle-images/:id/approve  body candidateIndex (default 0)
//   POST /api/admin/vehicle-images/:id/reject
//   POST /api/admin/vehicle-images/seed         Step 0 import (0 CarsXE calls)
//
// Auth is HTTP Basic with CARSXE_ADMIN_PASSWORD. If that env var is unset the
// page answers 503 instead of being open to the world — a page that publishes
// rider-visible assets must never be accidentally public.
// ─────────────────────────────────────────────────────────────────────────────
import express, { Request, Response } from "express";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { s3 } from "../lib/s3";
import {
  approveVehicleImage,
  carsxeUsage,
  importSeedImage,
  listVehicleImages,
  rejectVehicleImage,
  refetchVehicleImage,
  ensureVehicleImageTables,
} from "../services/vehicleImages";

const router = express.Router();

const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string)
  );

function requireAdmin(req: Request, res: Response): boolean {
  const password = process.env.CARSXE_ADMIN_PASSWORD || "";
  if (!password) {
    res.status(503).send("CARSXE_ADMIN_PASSWORD is not set on the server — the review page is disabled.");
    return false;
  }
  const header = String(req.headers.authorization || "");
  const expected = "Basic " + Buffer.from(`admin:${password}`).toString("base64");
  if (header !== expected) {
    res.set("WWW-Authenticate", 'Basic realm="Vura vehicle images"');
    res.status(401).send("Authentication required.");
    return false;
  }
  return true;
}

// ── public: our own copy, straight from our bucket (never the source link) ────
router.get("/vehicle-images/:file", async (req: Request, res: Response) => {
  const file = String(req.params.file || "");
  // One flat namespace, no traversal: letters, digits, dash, dot, underscore only.
  if (!/^[a-z0-9._-]{3,160}$/i.test(file)) { res.status(400).end(); return; }
  const bucket = process.env.AWS_S3_BUCKET;
  if (!bucket) { res.status(503).end(); return; }
  try {
    const out = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: `vehicle-images/${file}` }));
    if (!out.Body) { res.status(404).end(); return; }
    res.set("Content-Type", out.ContentType || "image/webp");
    res.set("Cache-Control", "public, max-age=31536000, immutable");
    const bytes = await out.Body.transformToByteArray();
    res.end(Buffer.from(bytes));
  } catch {
    res.status(404).end();
  }
});

// ── the review page ──────────────────────────────────────────────────────────
router.get("/admin/vehicle-images", async (req: Request, res: Response) => {
  if (!requireAdmin(req, res)) return;
  await ensureVehicleImageTables();
  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  const rows = await listVehicleImages(status);
  const budget = await carsxeUsage();
  const ref = process.env.VEHICLE_STYLE_REFERENCE_URL || "";

  const card = (row: any) => {
    const candidates: any[] = Array.isArray(row.candidates) ? row.candidates : [];
    const shown = candidates.length ? candidates : row.image_url ? [{ url: row.image_url }] : [];
    const thumbs = shown
      .map(
        (c, i) => `<figure class="cand"><label>
        <input type="radio" name="candidateIndex" value="${i}" ${i === 0 ? "checked" : ""}>
        <img src="${esc(c.url)}" alt="candidate ${i + 1}">
        <figcaption>#${i + 1}${c.score !== undefined ? ` · score ${esc(c.score)}` : ""}${
          c.note ? `<br><span class="note">${esc(c.note)}</span>` : ""
        }</figcaption></label></figure>`
      )
      .join("");
    return `<section class="row">
      <div class="previews">
        <div class="white"><img src="${esc(row.image_url || "")}" alt=""><span class="badge">white</span></div>
        <div class="grey"><img src="${esc(row.image_url || "")}" alt=""><span class="badge">grey</span></div>
        ${ref ? `<div class="white"><img src="${esc(ref)}" alt=""><span class="badge">style ref</span></div>` : ""}
      </div>
      <div class="meta">
        <h3>${esc(row.make)} ${esc(row.model)} <span class="pill">${esc(row.status)}</span></h3>
        <p><b>cache_key</b> ${esc(row.cache_key)}<br>
           <b>source page</b> ${row.context_link ? `<a href="${esc(row.context_link)}" target="_blank" rel="noopener">${esc(row.context_link)}</a>` : "—"}<br>
           <b>stored copy</b> ${esc(row.image_url)}<br>
           <b>size</b> ${esc(row.width)}×${esc(row.height)} · <b>calls</b> ${esc(row.api_calls_used)}</p>
        <form method="post" action="/api/admin/vehicle-images/${esc(row.id)}/approve">
          <div class="cands">${thumbs || "<i>no candidates</i>"}</div>
          <button type="submit">Approve the chosen candidate</button>
        </form>
        <form method="post" action="/api/admin/vehicle-images/${esc(row.id)}/reject">
          <button class="danger" type="submit">Reject (never retried automatically)</button>
        </form>
        <form method="post" action="/api/admin/vehicle-images/${esc(row.id)}/refetch">
          <button type="submit">Re-fetch from CarsXE (1 call &#183; keeps the live image)</button>
        </form>
      </div></section>`;
  };

  const css =
    "body{font:15px/1.5 system-ui,sans-serif;margin:0;background:#f5f6f8;color:#15181d}" +
    "header{background:#15181d;color:#fff;padding:14px 20px;display:flex;gap:14px;align-items:center;flex-wrap:wrap}" +
    "a{color:#0b62d0}header a{color:#9fc4ff}" +
    ".row{background:#fff;margin:16px;padding:16px;border-radius:12px;display:flex;gap:20px;flex-wrap:wrap}" +
    ".previews{display:flex;gap:10px;flex-wrap:wrap}.previews>div{width:200px;height:136px;border-radius:10px;display:flex;align-items:center;justify-content:center;overflow:hidden;position:relative}" +
    ".white{background:#fff;border:1px solid #e3e5e8}.grey{background:#dfe2e6}.previews img{max-width:100%;max-height:100%}" +
    ".badge{position:absolute;bottom:4px;right:6px;font-size:11px;color:#8a929c}.meta{flex:1;min-width:320px}" +
    ".cands{display:flex;gap:10px;flex-wrap:wrap;margin:8px 0}.cand{margin:0;border:1px solid #e3e5e8;border-radius:10px;padding:6px;width:168px}" +
    ".cand img{width:100%;height:92px;object-fit:contain;background:#fff}.cand figcaption{font-size:12px;color:#5b6470}" +
    ".note{color:#8a929c;font-size:11px}.pill{background:#e9edf2;color:#39424e;border-radius:20px;padding:2px 9px;font-size:12px}" +
    "button{background:#0b62d0;color:#fff;border:0;border-radius:8px;padding:9px 14px;cursor:pointer;margin-top:6px}" +
    "button.danger{background:#b3261e}form{display:inline-block;margin-right:8px}";

  const nav = ["pending", "approved", "rejected", "none_found", ""]
    .map((s) => `<a href="/api/admin/vehicle-images${s ? `?status=${s}` : ""}">${s || "all"}</a>`)
    .join(" · ");

  res.set("Content-Type", "text/html; charset=utf-8").send(`<!doctype html><html><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Vehicle images · ${budget.used}/${budget.max} calls used</title><style>${css}</style></head><body>
<header><b>Vehicle images</b>
<span class="pill">CarsXE calls used: ${budget.used} / ${budget.max} (${budget.left} left)</span>
<span class="pill">${rows.length} row(s)${status ? ` · ${esc(status)}` : ""}</span><span>${nav}</span></header>
${rows.length ? rows.map(card).join("") : "<p style='margin:20px'>Nothing here yet — import a dashboard search, or register a driver vehicle.</p>"}
</body></html>`);
});

// ── actions ──────────────────────────────────────────────────────────────────
router.post("/admin/vehicle-images/:id/approve", async (req: Request, res: Response) => {
  if (!requireAdmin(req, res)) return;
  const raw = req.body?.candidateIndex ?? req.query.candidateIndex ?? "0";
  const idx = parseInt(String(raw), 10);
  const out = await approveVehicleImage(String(req.params.id), Number.isFinite(idx) ? idx : 0);
  if (!out) { res.status(404).json({ error: "not found" }); return; }
  if (req.headers.accept?.includes("text/html")) {
    res.redirect("/api/admin/vehicle-images?status=pending");
    return;
  }
  res.json({ success: true, ...out, budget: await carsxeUsage() });
});

router.post("/admin/vehicle-images/:id/reject", async (req: Request, res: Response) => {
  if (!requireAdmin(req, res)) return;
  const out = await rejectVehicleImage(String(req.params.id));
  if (req.headers.accept?.includes("text/html")) {
    res.redirect("/api/admin/vehicle-images?status=pending");
    return;
  }
  res.json({ success: true, ...out });
});

/**
 * Re-fetch an existing row (1 CarsXE call) so a car that was approved before the
 * studio-shot picker existed can be re-picked. The live image stays up while the
 * fresh candidates wait for approval.
 */
router.post("/admin/vehicle-images/:id/refetch", async (req: Request, res: Response) => {
  if (!requireAdmin(req, res)) return;
  try {
    const out = await refetchVehicleImage(String(req.params.id));
    if (!out) { res.status(404).json({ error: "not found" }); return; }
    if (req.headers.accept?.includes("text/html")) {
      res.redirect("/api/admin/vehicle-images");
      return;
    }
    res.json({ success: true, ...out });
  } catch (err: any) {
    console.error("Refetch error:", err?.message || err);
    res.status(500).json({ error: err?.message || "refetch failed" });
  }
});

/** Step 0 — the local importer posts the finished WebP here. No CarsXE call. */
router.post("/admin/vehicle-images/seed", async (req: Request, res: Response) => {
  if (!requireAdmin(req, res)) return;
  try {
    const body = req.body || {};
    if (!body.cacheKey || !body.image) {
      res.status(400).json({ error: "cacheKey and image (base64 webp) are required" });
      return;
    }
    const out = await importSeedImage({
      cacheKey: String(body.cacheKey),
      make: String(body.make || ""),
      model: String(body.model || ""),
      year: body.year ?? null,
      colour: body.colour ?? null,
      sourceUrl: body.sourceUrl ?? null,
      contextLink: body.contextLink ?? null,
      licenceNote: body.licenceNote ?? null,
      webpBase64: String(body.image),
      candidates: Array.isArray(body.candidates) ? body.candidates : [],
    });
    res.json({
      success: true,
      cacheKey: out.row?.cache_key,
      imageUrl: out.candidate.url,
      budget: out.budget,
    });
  } catch (err: any) {
    console.error("Seed import error:", err?.message || err);
    res.status(500).json({ error: err?.message || "import failed" });
  }
});

export default router;
