"use strict";
// ─────────────────────────────────────────────────────────────────────────────
// format — server-side masking/format helpers for admin responses (POPIA).
// The admin app has its own copy for display; this one masks at the API edge
// so raw values never leave the server in LIST responses.
// ─────────────────────────────────────────────────────────────────────────────
Object.defineProperty(exports, "__esModule", { value: true });
exports.maskPhone = maskPhone;
exports.maskId = maskId;
/** POPIA list masking: 082 123 4567 → 082***4567. */
function maskPhone(phone) {
    if (!phone)
        return "—";
    const compact = phone.replace(/\s+/g, "");
    if (compact.length < 6)
        return "•••";
    return `${compact.slice(0, 3)}***${compact.slice(-4)}`;
}
/** POPIA list masking: 9001015800089 → 900101****89. */
function maskId(id) {
    if (!id)
        return "—";
    const compact = id.replace(/\s+/g, "");
    if (compact.length < 6)
        return "•••";
    return `${compact.slice(0, 6)}****${compact.slice(-2)}`;
}
//# sourceMappingURL=format.js.map