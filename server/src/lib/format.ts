// ─────────────────────────────────────────────────────────────────────────────
// format — server-side masking/format helpers for admin responses (POPIA).
// The admin app has its own copy for display; this one masks at the API edge
// so raw values never leave the server in LIST responses.
// ─────────────────────────────────────────────────────────────────────────────

/** POPIA list masking: 082 123 4567 → 082***4567. */
export function maskPhone(phone: string | null | undefined): string {
  if (!phone) return "—";
  const compact = phone.replace(/\s+/g, "");
  if (compact.length < 6) return "•••";
  return `${compact.slice(0, 3)}***${compact.slice(-4)}`;
}

/** POPIA list masking: 9001015800089 → 900101****89. */
export function maskId(id: string | null | undefined): string {
  if (!id) return "—";
  const compact = id.replace(/\s+/g, "");
  if (compact.length < 6) return "•••";
  return `${compact.slice(0, 6)}****${compact.slice(-2)}`;
}