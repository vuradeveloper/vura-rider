"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.notifySos = notifySos;
exports.notifyCheckinTimeout = notifyCheckinTimeout;
const adminInvite_1 = require("./adminInvite");
function escapeHtml(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}
function mapsLink(location) {
    const lat = Number(location?.lat);
    const lng = Number(location?.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng))
        return null;
    return `https://www.google.com/maps?q=${lat},${lng}`;
}
function detailRows(payload, shareUrl) {
    const rider = payload?.rider || {};
    const driver = payload?.driver || {};
    const rows = [
        ["Rider", rider.name, rider.phone],
        ["Driver", driver.name, driver.phone],
        ["Vehicle", driver.car, driver.plate ? `Plate ${driver.plate}` : null],
        ["Route", payload?.pickup_address, payload?.destination_address],
        ["Triggered", payload?.triggered_at, payload?.role ? `by ${payload.role}` : null],
    ];
    const html = rows
        .filter(([, a, b]) => a || b)
        .map(([label, a, b]) => `<tr><td style="padding:4px 14px 4px 0;color:#888">${escapeHtml(label)}</td><td>${escapeHtml([a, b].filter(Boolean).join(" · "))}</td></tr>`)
        .join("");
    const map = mapsLink(payload?.location);
    const location = payload?.location
        ? `<p><b>Last location:</b> ${Number(payload.location.lat).toFixed(5)}, ${Number(payload.location.lng).toFixed(5)}${payload.location.at ? ` (${escapeHtml(payload.location.at)})` : ""}${map ? ` · <a href="${map}">Open in maps</a>` : ""}</p>`
        : "<p><b>Location:</b> no fix yet — the live trip link below updates automatically.</p>";
    const link = shareUrl
        ? `<p><b>Live trip:</b> <a href="${escapeHtml(shareUrl)}">${escapeHtml(shareUrl)}</a></p>`
        : "";
    return `<table style="border-collapse:collapse;margin:12px 0">${html}</table>${location}${link}`;
}
function safeEmails(contacts) {
    return Array.from(new Set(contacts
        .map((c) => String(c.email || "").trim().toLowerCase())
        .filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e))));
}
function safeSubject(value) {
    return String(value || "").replace(/[\r\n]+/g, " ").slice(0, 150);
}
async function sendToMany(emails, subject, html) {
    if (!emails.length)
        return 0;
    const cleanSubject = safeSubject(subject);
    let sent = 0;
    await Promise.all(emails.map(async (to) => {
        const res = await (0, adminInvite_1.sendResendEmail)({ to, subject: cleanSubject, html }).catch(() => ({ ok: false }));
        if (res.ok)
            sent++;
    }));
    return sent;
}
async function notifySos(input) {
    const riderName = input.payload?.rider?.name ||
        input.payload?.driver?.name ||
        "A Vura user";
    const subject = `Vura SOS — ${riderName} needs help`;
    const html = `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;color:#1A1A1A">
      <div style="background:#B3261E;color:#fff;padding:14px 18px;border-radius:10px">
        <h2 style="margin:0">Emergency SOS</h2>
        <p style="margin:6px 0 0">${escapeHtml(riderName)} triggered an SOS in the Vura app.</p>
      </div>
      ${detailRows(input.payload, input.shareUrl)}
      <p><b>What to do now:</b> call them. If they do not answer and you believe they are in danger,
      call the South African emergency number <b>10111</b> (police) or <b>112</b> (ambulance).</p>
      <p style="color:#888;font-size:12px">Vura's safety team has also been alerted. Vura does not
      call emergency services automatically, and this email is not a substitute for them.</p>
    </div>`;
    const contactEmails = safeEmails(input.contacts);
    const contactsNotified = await sendToMany(contactEmails, subject, html);
    const team = String(process.env.SAFETY_ALERT_EMAIL || "")
        .split(",")
        .map((e) => e.trim())
        .filter(Boolean);
    const teamSent = await sendToMany(team, subject, html);
    if (!team.length) {
        console.warn("[safety] SAFETY_ALERT_EMAIL is not set — SOS is console-only");
    }
    return { contacts_notified: contactsNotified, safety_team_notified: teamSent > 0 };
}
async function notifyCheckinTimeout(input) {
    const subject = `Vura RideCheck: no response on ride ${input.rideId.slice(0, 8)}`;
    const html = `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;color:#1A1A1A">
      <div style="background:#B26A00;color:#fff;padding:14px 18px;border-radius:10px">
        <h2 style="margin:0">RideCheck — no response</h2>
        <p style="margin:6px 0 0">An anomaly check-in passed its deadline without an answer.</p>
      </div>
      ${detailRows(input.payload, input.shareUrl)}
      <p><b>Action:</b> open the admin Safety → Anomalies queue and contact the rider.</p>
    </div>`;
    const team = String(process.env.SAFETY_ALERT_EMAIL || "")
        .split(",")
        .map((e) => e.trim())
        .filter(Boolean);
    if (!team.length) {
        console.warn("[safety] SAFETY_ALERT_EMAIL is not set — check-in timeout is console-only");
        return;
    }
    await sendToMany(team, subject, html);
}
//# sourceMappingURL=safetyNotify.js.map