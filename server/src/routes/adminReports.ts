import { Router, Response } from "express";
import { AuthRequest } from "../middleware/auth";
import { requireAdmin, resolveAdminActor, writeAudit } from "../services/adminAuth";
import {
  ReportError,
  getDispute,
  getLostItem,
  isReportId,
  listDisputes,
  listLostItems,
  updateDispute,
  updateLostItem,
} from "../services/adminReports";

/**
 * Admin support queue.
 *
 *   GET   /api/admin/v2/disputes            disputes (refund requests excluded)
 *   GET   /api/admin/v2/disputes/:id        one dispute
 *   PATCH /api/admin/v2/disputes/:id        triage / resolution
 *   GET   /api/admin/v2/refunds             refund requests (type='refund')
 *   PATCH /api/admin/v2/refunds/:id         refund decision + Paystack reference
 *   GET   /api/admin/v2/lost-items          lost-item reports
 *   GET   /api/admin/v2/lost-items/:id      one lost-item report
 *   PATCH /api/admin/v2/lost-items/:id      triage / resolution
 *
 * No money moves here. A refund decision records the operator's approval and
 * the Paystack reference so finance can reconcile it; the actual refund stays a
 * Paystack dashboard action.
 */

const router = Router();

function fail(res: Response, err: any, fallback: string) {
  const status =
    err instanceof ReportError ? err.statusCode : Number(err?.statusCode) || 500;
  if (status >= 500) console.error(`[adminReports] ${fallback}:`, err?.message || err);
  res.status(status).json({ error: err?.message || fallback });
}

function listOpts(req: AuthRequest) {
  return {
    limit: req.query.limit,
    offset: req.query.offset,
  };
}

function disputeFilters(req: AuthRequest, opts: { includeRefunds: boolean }) {
  return {
    status: req.query.status ? String(req.query.status) : "active",
    search: req.query.search ? String(req.query.search) : undefined,
    type: req.query.type ? String(req.query.type) : opts.includeRefunds ? "refund" : undefined,
    excludeType: opts.includeRefunds ? undefined : "refund",
  };
}

function disputePatch(body: any) {
  return {
    status: body?.status,
    resolution: body?.resolution,
    admin_note: body?.admin_note,
    assigned_to: body?.assigned_to,
    refund_status: body?.refund_status,
    refund_reference: body?.refund_reference,
    refund_amount: body?.refund_amount,
  };
}

function auditShape(row: any) {
  if (!row) return null;
  return {
    status: row.status,
    resolution: row.resolution ?? null,
    admin_note: row.admin_note ?? null,
    assigned_to: row.assigned_to ?? null,
    refund_status: row.refund_status ?? null,
    refund_reference: row.refund_reference ?? null,
    refund_amount: row.refund_amount ?? null,
    driver_contacted: row.driver_contacted ?? null,
  };
}

// ── Disputes ─────────────────────────────────────────────────────────────────

router.get("/disputes", requireAdmin("tickets.read"), async (req: AuthRequest, res: Response) => {
  try {
    const result = await listDisputes(disputeFilters(req, { includeRefunds: false }), listOpts(req));
    res.json(result);
  } catch (err: any) {
    fail(res, err, "Could not load disputes");
  }
});

router.get("/disputes/:id", requireAdmin("tickets.read"), async (req: AuthRequest, res: Response) => {
  try {
    const id = String(req.params.id);
    if (!isReportId(id)) {
      res.status(400).json({ error: "Invalid report id" });
      return;
    }
    const dispute = await getDispute(id);
    if (!dispute) {
      res.status(404).json({ error: "Report not found" });
      return;
    }
    res.json({ dispute });
  } catch (err: any) {
    fail(res, err, "Could not load the report");
  }
});

router.patch("/disputes/:id", requireAdmin("tickets.write"), async (req: AuthRequest, res: Response) => {
  try {
    const id = String(req.params.id);
    if (!isReportId(id)) {
      res.status(400).json({ error: "Invalid report id" });
      return;
    }
    const before = await getDispute(id);
    if (!before) {
      res.status(404).json({ error: "Report not found" });
      return;
    }
    const actor = await resolveAdminActor(req);
    if (!actor) {
      res.status(403).json({ error: "Admin only" });
      return;
    }
    const patch = disputePatch(req.body);
    if (patch.status === "in_review" && !patch.assigned_to) {
      patch.assigned_to = actor.email;
    }
    const dispute = await updateDispute(id, patch);
    if (!dispute) {
      res.status(404).json({ error: "Report not found" });
      return;
    }
    await writeAudit(actor, {
      action: "dispute.update",
      entityType: "dispute",
      entityId: id,
      oldValue: auditShape(before),
      newValue: auditShape(dispute),
      reason: patch.resolution || undefined,
    });
    res.json({ dispute });
  } catch (err: any) {
    fail(res, err, "Could not update the report");
  }
});

// ── Refund requests ──────────────────────────────────────────────────────────

router.get("/refunds", requireAdmin("tickets.read"), async (req: AuthRequest, res: Response) => {
  try {
    const result = await listDisputes(disputeFilters(req, { includeRefunds: true }), listOpts(req));
    res.json({ refunds: result.disputes, total: result.total, counts: result.counts });
  } catch (err: any) {
    fail(res, err, "Could not load refund requests");
  }
});

router.patch("/refunds/:id", requireAdmin("tickets.write"), async (req: AuthRequest, res: Response) => {
  try {
    const id = String(req.params.id);
    if (!isReportId(id)) {
      res.status(400).json({ error: "Invalid report id" });
      return;
    }
    const before = await getDispute(id);
    if (!before) {
      res.status(404).json({ error: "Refund request not found" });
      return;
    }
    if (before.type !== "refund") {
      res.status(400).json({ error: "This report is not a refund request" });
      return;
    }
    const actor = await resolveAdminActor(req);
    if (!actor) {
      res.status(403).json({ error: "Admin only" });
      return;
    }
    const patch = disputePatch(req.body);
    if (patch.status === "in_review" && !patch.assigned_to) {
      patch.assigned_to = actor.email;
    }
    const dispute = await updateDispute(id, patch, { requireRefund: true });
    if (!dispute) {
      res.status(404).json({ error: "Refund request not found" });
      return;
    }
    await writeAudit(actor, {
      action: "refund.update",
      entityType: "dispute",
      entityId: id,
      oldValue: auditShape(before),
      newValue: auditShape(dispute),
      reason: patch.resolution || undefined,
    });
    res.json({ refund: dispute });
  } catch (err: any) {
    fail(res, err, "Could not update the refund request");
  }
});

// ── Lost items ───────────────────────────────────────────────────────────────

router.get("/lost-items", requireAdmin("tickets.read"), async (req: AuthRequest, res: Response) => {
  try {
    const result = await listLostItems(
      {
        status: req.query.status ? String(req.query.status) : "active",
        search: req.query.search ? String(req.query.search) : undefined,
      },
      listOpts(req)
    );
    res.json(result);
  } catch (err: any) {
    fail(res, err, "Could not load lost-item reports");
  }
});

router.get("/lost-items/:id", requireAdmin("tickets.read"), async (req: AuthRequest, res: Response) => {
  try {
    const id = String(req.params.id);
    if (!isReportId(id)) {
      res.status(400).json({ error: "Invalid report id" });
      return;
    }
    const report = await getLostItem(id);
    if (!report) {
      res.status(404).json({ error: "Lost-item report not found" });
      return;
    }
    res.json({ report });
  } catch (err: any) {
    fail(res, err, "Could not load the lost-item report");
  }
});

router.patch("/lost-items/:id", requireAdmin("tickets.write"), async (req: AuthRequest, res: Response) => {
  try {
    const id = String(req.params.id);
    if (!isReportId(id)) {
      res.status(400).json({ error: "Invalid report id" });
      return;
    }
    const before = await getLostItem(id);
    if (!before) {
      res.status(404).json({ error: "Lost-item report not found" });
      return;
    }
    const actor = await resolveAdminActor(req);
    if (!actor) {
      res.status(403).json({ error: "Admin only" });
      return;
    }
    const body = req.body || {};
    const patch = {
      status: body.status,
      resolution: body.resolution,
      admin_note: body.admin_note,
      assigned_to: body.assigned_to,
      driver_contacted:
        body.driver_contacted === undefined ? undefined : body.driver_contacted === true,
    };
    if (patch.status === "in_review" && !patch.assigned_to) {
      patch.assigned_to = actor.email;
    }
    const report = await updateLostItem(id, patch);
    if (!report) {
      res.status(404).json({ error: "Lost-item report not found" });
      return;
    }
    await writeAudit(actor, {
      action: "lost_item.update",
      entityType: "lost_item_report",
      entityId: id,
      oldValue: auditShape(before),
      newValue: auditShape(report),
      reason: patch.resolution || undefined,
    });
    res.json({ report });
  } catch (err: any) {
    fail(res, err, "Could not update the lost-item report");
  }
});

export default router;
