// ─────────────────────────────────────────────────────────────────────────────
// The 12 vehicle colours, as NAMES (what the DB stores) mapped to HEX (what the
// SVG recolouring needs). Kept in step with server/src/data/vehicleCatalogue.ts —
// same names, same hex — so the driver picks a name and the rider paints it.
//
// Everything here is bundled in the app: no network, no API key, works offline.
// ─────────────────────────────────────────────────────────────────────────────

export const CAR_COLOURS: { name: string; hex: string }[] = [
  { name: 'White', hex: '#F5F5F5' },
  { name: 'Black', hex: '#1C1C1E' },
  { name: 'Silver', hex: '#C0C4C8' },
  { name: 'Grey', hex: '#7A7F85' },
  { name: 'Red', hex: '#C62828' },
  { name: 'Blue', hex: '#1E4FA3' },
  { name: 'Green', hex: '#2E7D32' },
  { name: 'Brown', hex: '#6D4C41' },
  { name: 'Gold', hex: '#C9A227' },
  { name: 'Orange', hex: '#EF6C00' },
  { name: 'Yellow', hex: '#F9C80E' },
  { name: 'Beige', hex: '#D9C7A3' },
]

export const FALLBACK_COLOUR = 'Silver'
export const FALLBACK_COLOUR_HEX = '#C0C4C8' // unknown colour -> silver
export const GENERIC_CAR_HEX = '#9AA0A6' // no vehicle data at all -> neutral grey

export type BodyType = 'hatchback' | 'sedan' | 'suv' | 'bakkie' | 'minibus'
export const BODY_TYPES: BodyType[] = ['hatchback', 'sedan', 'suv', 'bakkie', 'minibus']

const norm = (s: unknown) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ')

/** Colour NAME for any stored value — always one of the palette names. */
export function colourNameOf(raw?: string | null): string {
  const s = norm(raw)
  if (!s) return FALLBACK_COLOUR
  const exact = CAR_COLOURS.find((c) => norm(c.name) === s)
  if (exact) return exact.name
  if (/silver|chrome/.test(s)) return 'Silver'
  if (/white|wit/.test(s)) return 'White'
  if (/black|swart/.test(s)) return 'Black'
  if (/grey|gray|charcoal/.test(s)) return 'Grey'
  if (/red|rooi/.test(s)) return 'Red'
  if (/blue|blou/.test(s)) return 'Blue'
  if (/green|groen/.test(s)) return 'Green'
  if (/brown|maroon/.test(s)) return 'Brown'
  if (/gold|champagne/.test(s)) return 'Gold'
  if (/orange/.test(s)) return 'Orange'
  if (/yellow|geel/.test(s)) return 'Yellow'
  if (/beige|cream|tan/.test(s)) return 'Beige'
  return FALLBACK_COLOUR
}

/** Hex for any stored colour — never throws, never returns an empty string. */
export function hexFromColourName(raw?: string | null): string {
  const name = colourNameOf(raw)
  return (CAR_COLOURS.find((c) => c.name === name) || CAR_COLOURS[2]).hex
}

/** Any unknown/empty body type becomes the hatchback silhouette. */
export function normaliseBody(raw?: string | null): BodyType {
  const s = norm(raw)
  const hit = BODY_TYPES.find((b) => b === s)
  if (hit) return hit
  if (/pickup|truck|ldv|cab/.test(s)) return 'bakkie'
  if (/van|bus|mpv|people/.test(s)) return 'minibus'
  if (/wagon|estate|boot/.test(s)) return 'sedan'
  if (/4x4|suv|cross/.test(s)) return 'suv'
  return 'hatchback'
}

/** Perceived brightness 0..1 — decides the outline and highlight strength. */
export function hexLuminance(hex: string): number {
  const h = hex.replace('#', '')
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h
  const r = parseInt(full.slice(0, 2), 16) / 255
  const g = parseInt(full.slice(2, 4), 16) / 255
  const b = parseInt(full.slice(4, 6), 16) / 255
  if ([r, g, b].some((v) => Number.isNaN(v))) return 0.6
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** Very light cars need a darker edge so they do not vanish on a white card. */
export function bodyOutline(hex: string): string {
  return hexLuminance(hex) > 0.72 ? 'rgba(0,0,0,0.28)' : 'rgba(0,0,0,0.16)'
}

/** Black cars need a stronger highlight so the shape still reads. */
export function highlightOpacity(hex: string): number {
  return hexLuminance(hex) < 0.16 ? 0.34 : 0.25
}

export function shadeOpacity(hex: string): number {
  return hexLuminance(hex) < 0.16 ? 0.28 : 0.15
}
