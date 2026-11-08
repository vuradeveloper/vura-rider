"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const adminAuth_1 = require("../services/adminAuth");
const liveSupport_1 = require("../services/liveSupport");
const notify_1 = require("../services/notify");
const router = (0, express_1.Router)();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function badId(id) {
    return !UUID_RE.test(id);
}
// GET /api/admin/v2/live-chats?status=open&search=...&limit=60&offset=0
router.get("/", (0, adminAuth_1.requireAdmin)("tickets.read"), async (req, res) => {
    try {
        const result = await (0, liveSupport_1.listLiveChats)({
            status: String(req.query.status || "open"),
            search: req.query.search ? String(req.query.search) : undefined,
            limit: req.query.limit ? Number(req.query.limit) : undefined,
            offset: req.query.offset ? Number(req.query.offset) : undefined,
        });
        res.json({ chats: result.rows, total: result.total });
    }
    catch (err) {
        res.status(500).json({ error: err?.message || "Could not load live chats" });
    }
});
// GET /api/admin/v2/live-chats/:id — chat + all messages (internal included)
router.get("/:id", (0, adminAuth_1.requireAdmin)("tickets.read"), async (req, res) => {
    try {
        const id = String(req.params.id);
        if (badId(id)) {
            res.status(400).json({ error: "Invalid chat id" });
            return;
        }
        const chat = await (0, liveSupport_1.getLiveChat)(id);
        if (!chat) {
            res.status(404).json({ error: "Live chat not found" });
            return;
        }
        res.json({ chat });
    }
    catch (err) {
        res.status(500).json({ error: err?.message || "Could not load the chat" });
    }
});
// POST /api/admin/v2/live-chats/:id/messages — reply or internal note
router.post("/:id/messages", (0, adminAuth_1.requireAdmin)("tickets.write"), async (req, res) => {
    try {
        const id = String(req.params.id);
        if (badId(id)) {
            res.status(400).json({ error: "Invalid chat id" });
            return;
        }
        const message = String(req.body?.message || "").trim();
        if (message.length < 1) {
            res.status(400).json({ error: "Type a reply first" });
            return;
        }
        const actor = await (0, adminAuth_1.resolveAdminActor)(req);
        if (!actor) {
            res.status(403).json({ error: "Admin only" });
            return;
        }
        const chat = await (0, liveSupport_1.sendAdminMessage)({
            chatId: id,
            adminEmail: actor.email,
            message,
            isInternal: !!req.body?.is_internal,
        });
        if (!chat) {
            res.status(404).json({ error: "Live chat not found" });
            return;
        }
        await (0, adminAuth_1.writeAudit)(actor, {
            action: req.body?.is_internal ? "live_chat.note" : "live_chat.reply",
            entityType: "live_chat",
            entityId: id,
            newValue: { chars: message.length },
        });
        // A public agent reply reaches the rider/driver even when the app is
        // backgrounded or closed. Internal notes never leave the console.
        if (!req.body?.is_internal && chat?.rider_id) {
            const excerpt = message.replace(/\s+/g, " ").trim().slice(0, 120);
            void (0, notify_1.sendPushToUsers)([String(chat.rider_id)], {
                type: "live_support",
                title: "Vura support replied",
                body: excerpt || "Open Live Support to read the reply.",
                channelId: "ride_updates",
                data: { kind: "live_support", chat_id: id },
            }).catch((err) => console.warn("[live-support] reply push failed:", err?.message || err));
        }
        res.json({ chat });
    }
    catch (err) {
        res.status(400).json({ error: err?.message || "Could not send the message" });
    }
});
// PATCH /api/admin/v2/live-chats/:id — status / assignee / priority
router.patch("/:id", (0, adminAuth_1.requireAdmin)("tickets.write"), async (req, res) => {
    try {
        const id = String(req.params.id);
        if (badId(id)) {
            res.status(400).json({ error: "Invalid chat id" });
            return;
        }
        const before = await (0, liveSupport_1.getLiveChat)(id);
        if (!before) {
            res.status(404).json({ error: "Live chat not found" });
            return;
        }
        const actor = await (0, adminAuth_1.resolveAdminActor)(req);
        if (!actor) {
            res.status(403).json({ error: "Admin only" });
            return;
        }
        const chat = await (0, liveSupport_1.updateLiveChat)(id, {
            status: req.body?.status ? String(req.body.status) : undefined,
            assignee_email: req.body?.assignee_email !== undefined
                ? (req.body.assignee_email ? String(req.body.assignee_email) : null)
                : undefined,
            priority: req.body?.priority ? String(req.body.priority) : undefined,
        });
        await (0, adminAuth_1.writeAudit)(actor, {
            action: "live_chat.update",
            entityType: "live_chat",
            entityId: id,
            oldValue: { status: before.status, assignee: before.assignee_email },
            newValue: { status: chat?.status, assignee: chat?.assignee_email },
        });
        res.json({ chat });
    }
    catch (err) {
        res.status(400).json({ error: err?.message || "Could not update the chat" });
    }
});
exports.default = router;
//# sourceMappingURL=adminLiveSupport.js.map