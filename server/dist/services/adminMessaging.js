"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CAMPAIGN_AUDIENCES = void 0;
exports.isCampaignAudience = isCampaignAudience;
exports.listCampaigns = listCampaigns;
exports.getCampaign = getCampaign;
exports.createCampaign = createCampaign;
exports.sendCampaign = sendCampaign;
// ─────────────────────────────────────────────────────────────────────────────
// adminMessaging — ADMIN V2 Phase 4: targeted push campaigns.
//
// SAFETY RAILS (deliberate, per brief):
//   • audiences are fixed segments (riders / drivers / all) — no arbitrary
//     user-id lists, so a typo can never DM one random person;
//   • a campaign sends ONCE (status draft → sending → sent/failed, guarded
//     by UPDATE ... WHERE status='draft' so double-clicks cannot re-send);
//   • fan-out batches through the EXISTING sendPushToUsers path with a small
//     delay between batches — no new delivery machinery, notifications_log
//     still records every push (now tagged with campaign_id);
//   • every create/send writes an admin_audit_log row.
// ─────────────────────────────────────────────────────────────────────────────
const database_1 = require("../config/database");
const notify_1 = require("./notify");
exports.CAMPAIGN_AUDIENCES = ["riders", "drivers", "all"];
function isCampaignAudience(v) {
    return typeof v === "string" && exports.CAMPAIGN_AUDIENCES.includes(v);
}
/** Resolve a segment to user ids (chunked reads; never loads phone tokens). */
async function audienceIds(audience) {
    const roleClause = audience === "riders"
        ? `role IN ('passenger', 'rider')`
        : audience === "drivers"
            ? `role = 'driver'`
            : `role IN ('passenger', 'rider', 'driver')`;
    const rows = await (0, database_1.query)(`SELECT id FROM users WHERE ${roleClause} ORDER BY created_at DESC LIMIT 20000`);
    return rows.map((r) => r.id);
}
async function listCampaigns(limit = 100) {
    return (0, database_1.query)(`SELECT * FROM admin_campaigns ORDER BY created_at DESC LIMIT $1`, [Math.min(Math.max(limit, 1), 500)]);
}
async function getCampaign(id) {
    const row = await (0, database_1.queryOne)(`SELECT * FROM admin_campaigns WHERE id = $1`, [id]);
    if (!row)
        return null;
    // Delivery breakdown from the existing notifications_log (best-effort: the
    // column only exists after 008, and older DBs just see zeroes).
    let delivery = null;
    try {
        delivery = await (0, database_1.queryOne)(`SELECT COUNT(*)::int AS attempts,
              COUNT(*) FILTER (WHERE delivery_status = 'sent')::int AS delivered,
              COUNT(*) FILTER (WHERE delivery_status NOT IN ('sent', 'delivered'))::int AS not_delivered
         FROM notifications_log WHERE campaign_id = $1`, [id]);
    }
    catch (err) {
        if (!(0, database_1.isMissingRelation)(err))
            throw err;
    }
    return { ...row, delivery };
}
async function createCampaign(input, actorEmail) {
    return (0, database_1.queryOne)(`INSERT INTO admin_campaigns (name, title, body, audience, created_by)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`, [input.name, input.title, input.body, input.audience, actorEmail]);
}
/**
 * Send once. The status flip is the lock: only one caller can move
 * draft → sending, so a double-click is a no-op (returns null).
 * Fan-out runs awaited in batches of 500 with 100ms pauses; per-push
 * failures are counted, never thrown (a dead token must not fail the
 * campaign). Returns the finished row, or null if it was already sent.
 */
async function sendCampaign(id, actorEmail) {
    const claimed = await (0, database_1.queryOne)(`UPDATE admin_campaigns
        SET status = 'sending', sent_by = $2, started_at = NOW()
      WHERE id = $1 AND status = 'draft'
      RETURNING *`, [id, actorEmail]);
    if (!claimed)
        return null;
    try {
        const ids = await audienceIds(claimed.audience);
        await (0, database_1.execute)(`UPDATE admin_campaigns SET recipient_count = $2 WHERE id = $1`, [
            id,
            ids.length,
        ]);
        let sent = 0;
        let failed = 0;
        const BATCH = 500;
        for (let i = 0; i < ids.length; i += BATCH) {
            const batch = ids.slice(i, i + BATCH);
            try {
                const ok = await (0, notify_1.sendPushToUsers)(batch, {
                    title: claimed.title,
                    body: claimed.body,
                    type: "campaign",
                    campaignId: id,
                });
                if (ok === null)
                    failed += batch.length;
                else
                    sent += typeof ok === "number" ? ok : batch.length;
            }
            catch {
                failed += batch.length;
            }
            if (i + BATCH < ids.length)
                await new Promise((r) => setTimeout(r, 100));
        }
        const finished = await (0, database_1.queryOne)(`UPDATE admin_campaigns
          SET status = 'sent', sent_count = $2, failed_count = $3,
              recipient_count = $4, finished_at = NOW()
        WHERE id = $1 RETURNING *`, [id, sent, failed, ids.length]);
        return finished;
    }
    catch (err) {
        await (0, database_1.execute)(`UPDATE admin_campaigns SET status = 'failed', error = $2, finished_at = NOW() WHERE id = $1`, [id, String(err?.message || err).slice(0, 500)]);
        throw err;
    }
}
//# sourceMappingURL=adminMessaging.js.map