// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// <VehicleImage /> â€” the driver's car drawn as a NEUTRAL PLACEHOLDER, never in the car's own colour.
// Everything is bundled (no network, no API key, no <img>, so no CSP or
// CORS problem in the Capacitor WebView and it works offline).
//
// WHY THE SILHOUETTE IS NEUTRAL: it is a placeholder, not a picture of the car.
// Painting it in the driver's colour made it read as "this is your driver's car", so
// a rider could not tell a real photo from a drawing. The card's text still names the
// real colour, make and model, and a photo is used whenever one exists.
// Glass, tyres, rims, lights, trim and the ground shadow never change colour.
//
// The five silhouettes come from ONE parametric drawing, so the layering can never
// drift between body types: hatchback, sedan, suv, bakkie, minibus.
//
// Licence: drawn from scratch here â€” no third-party asset, nothing to attribute.
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
import type { CSSProperties } from 'react'
import {
  type BodyType,
  bodyOutline,
  colourNameOf,
  GENERIC_CAR_HEX,
  highlightOpacity,
  normaliseBody,
  shadeOpacity,
} from './palette'

type Geo = {
  roofX1: number; roofX2: number; roofY: number
  bonnetY: number; sillY: number
  frontX: number; rearX: number
  wheelR: number
  /** hatch = steep rear; boot = three-box sedan; bed = flat bakkie load bed */
  rear: 'hatch' | 'boot' | 'bed'
}

const W = 400
const H = 220

const GEO: Record<BodyType, Geo> = {
  hatchback: { roofX1: 152, roofX2: 250, roofY: 76, bonnetY: 98, sillY: 152, frontX: 44, rearX: 356, wheelR: 25, rear: 'hatch' },
  sedan:     { roofX1: 152, roofX2: 244, roofY: 82, bonnetY: 100, sillY: 152, frontX: 44, rearX: 356, wheelR: 25, rear: 'boot' },
  suv:       { roofX1: 144, roofX2: 262, roofY: 50, bonnetY: 88, sillY: 154, frontX: 42, rearX: 358, wheelR: 29, rear: 'hatch' },
  bakkie:    { roofX1: 150, roofX2: 230, roofY: 68, bonnetY: 92, sillY: 152, frontX: 44, rearX: 358, wheelR: 28, rear: 'bed' },
  minibus:   { roofX1: 118, roofX2: 336, roofY: 44, bonnetY: 92, sillY: 154, frontX: 40, rearX: 360, wheelR: 27, rear: 'hatch' },
}

/** The painted panels: doors, bonnet, roof, boot/bed. THE ONLY recoloured layer. */
function bodyPath(g: Geo): string {
  const rear = g.rear === 'boot' ? g.sillY - 66 : g.rear === 'bed' ? g.bonnetY + 4 : g.sillY - 58
  return [
    `M ${g.frontX + 16} ${g.sillY}`,
    `L ${g.frontX + 4} ${g.bonnetY + 10}`,
    `Q ${g.frontX + 6} ${g.bonnetY} ${g.frontX + 24} ${g.bonnetY}`,
    `L ${g.roofX1} ${g.bonnetY}`,
    `L ${g.roofX1 + 20} ${g.roofY}`,
    `L ${g.roofX2} ${g.roofY}`,
    g.rear === 'boot'
      ? `L ${g.rearX - 10} ${g.bonnetY + 2} L ${g.rearX} ${g.bonnetY + 14}`
      : g.rear === 'bed'
        ? `L ${g.roofX2 + 12} ${g.bonnetY + 4} L ${g.rearX} ${g.bonnetY + 4} L ${g.rearX} ${g.bonnetY + 22}`
        : `L ${g.rearX - 16} ${g.roofY + 16} L ${g.rearX} ${g.bonnetY + 12}`,
    `L ${g.rearX - 2} ${rear}`,
    `L ${g.rearX - 14} ${g.sillY}`,
    'Z',
  ].join(' ')
}

/** Windows + windscreen, so the car reads as a car even in one flat colour. */
function glassPath(g: Geo, body: BodyType): string {
  const top = g.roofY + 7
  const bottom = g.bonnetY - 6
  if (body === 'minibus') {
    // three panels, like a Quantum / H1
    const step = (g.roofX2 - g.roofX1 - 30) / 3
    return [0, 1, 2]
      .map((i) => {
        const x = g.roofX1 + 12 + i * step
        return `M ${x} ${top} L ${x + step - 10} ${top} L ${x + step - 10} ${bottom} L ${x} ${bottom} Z`
      })
      .join(' ')
  }
  const left = g.roofX1 + 22
  const right = g.rear === 'bed' ? g.roofX2 - 8 : g.roofX2 - 12
  return `M ${left} ${top} L ${right} ${top} L ${right - 16} ${bottom} L ${left + 10} ${bottom} Z`
}

/** Transparent dark band low on the body â€” works on any body colour. */
function shadePath(g: Geo): string {
  const y = g.sillY - 26
  return `M ${g.frontX + 10} ${y} L ${g.rearX - 12} ${y} L ${g.rearX - 14} ${g.sillY} L ${g.frontX + 16} ${g.sillY} Z`
}

/** Transparent white on the roof and bonnet â€” the "3D" read. */
function highlightPath(g: Geo): string {
  return [
    `M ${g.roofX1 + 24} ${g.roofY + 3} L ${g.roofX2 - 4} ${g.roofY + 3} L ${g.roofX2 - 8} ${g.roofY + 11} L ${g.roofX1 + 30} ${g.roofY + 11} Z`,
    `M ${g.frontX + 22} ${g.bonnetY + 2} L ${g.roofX1 - 4} ${g.bonnetY + 2} L ${g.roofX1 - 10} ${g.bonnetY + 10} L ${g.frontX + 26} ${g.bonnetY + 10} Z`,
  ].join(' ')
}

export type VehicleImageProps = {
  bodyType?: string | null
  /** px width (height follows the 400x220 ratio) */
  size?: number
  className?: string
}

export default function VehicleImage({ bodyType, size = 200, className }: VehicleImageProps) {
  const body = normaliseBody(bodyType)
  const g = GEO[body]
  const hex = GENERIC_CAR_HEX
  const tyre = '#14161A'
  const rim = '#9AA0A6'
  const glass = '#2A3B4C'

  const frontWheel = g.frontX + (body === 'bakkie' ? 86 : 92)
  const rearWheel = g.rearX - (body === 'bakkie' ? 104 : 96)

  const style: CSSProperties = { width: size, height: (size * H) / W, display: 'block' }
  const wrap = { ['--car-body' as any]: hex } as CSSProperties

  return (
    <div style={wrap} className={className}>
      <svg viewBox={`0 0 ${W} ${H}`} style={style} role="img"
        aria-label={`${body} car`} preserveAspectRatio="xMidYMid meet">
        {/* ground shadow â€” fixed */}
        <ellipse cx={200} cy={g.sillY + 24} rx={152} ry={12} fill="rgba(0,0,0,0.18)" />

        {/* tyres + rims â€” fixed */}
        {[frontWheel, rearWheel].map((cx) => (
          <g key={cx}>
            <circle cx={cx} cy={g.sillY + 8} r={g.wheelR} fill={tyre} />
            <circle cx={cx} cy={g.sillY + 8} r={g.wheelR * 0.52} fill={rim} />
            <circle cx={cx} cy={g.sillY + 8} r={g.wheelR * 0.2} fill="#6B7176" />
          </g>
        ))}

        {/* BODY â€” the only layer whose colour changes */}
        <path d={bodyPath(g)} fill="var(--car-body)"
          stroke={bodyOutline(hex)} strokeWidth={1.5} strokeLinejoin="round" />

        {/* SHADING on top of the body (transparent, so any colour works) */}
        <path d={shadePath(g)} fill={`rgba(0,0,0,${shadeOpacity(hex)})`} />
        <path d={highlightPath(g)} fill={`rgba(255,255,255,${highlightOpacity(hex)})`} />

        {/* glass, with a light reflection â€” fixed */}
        <path d={glassPath(g, body)} fill={glass} opacity={0.92} />
        <path
          d={`M ${g.roofX1 + 32} ${g.roofY + 10} L ${g.roofX1 + 62} ${g.roofY + 10} L ${g.roofX1 + 50} ${g.bonnetY - 12} L ${g.roofX1 + 34} ${g.bonnetY - 12} Z`}
          fill="rgba(255,255,255,0.18)"
        />

        {/* bumper / trim + grille â€” fixed */}
        <rect x={g.frontX + 8} y={g.sillY - 8} width={g.rearX - g.frontX - 20} height={10} rx={4} fill="#33363B" />
        <rect x={g.frontX + 20} y={g.bonnetY + 12} width={30} height={9} rx={3} fill="#24262A" />

        {/* headlight (front, right) + tail light â€” fixed */}
        <rect x={g.frontX + 8} y={g.bonnetY + 14} width={16} height={11} rx={3} fill="#FFF6D8" />
        <rect x={g.rearX - 18} y={g.bonnetY + 16} width={12} height={10} rx={2} fill="#D32F2F" />
      </svg>
    </div>
  )
}

/**
 * One function decides HOW a car is shown, so nothing on any screen has to care.
 *
 * Order:
 *   0. the photo the SERVER resolved for this car (`vehicle_image_url`) - a real,
 *      human-approved photo stored in our own bucket. This is the normal path now,
 *      because GET /api/drivers/vehicle-catalogue only offers cars that have one,
 *   1. a LOCAL PHOTO bundled by scripts/generate-vehicle-images.js, keyed
 *      make|model|colour. The bundle is currently EMPTY (0 entries) - the Car DB
 *      serves the photos server-side - so this is dead code kept deliberately, as
 *      the offline path if that generator is ever run again,
 *   2. otherwise a NEUTRAL placeholder silhouette: never painted in the car's colour,
 *      so a drawing can never be mistaken for a photo of the driver's car.
 *
 * The app never calls any image service at runtime; a future provider only has to
 * change this function's return value.
 */
import photoMap from '../../assets/vehiclePhotos.json'
import { absoluteApiUrl } from '../../lib/backend'

export type VehicleImageSpec =
  | { type: 'svg'; bodyType: BodyType }
  | { type: 'url'; url: string }

export function resolveVehicleImage(vehicle?: {
  make?: string | null
  model?: string | null
  colour?: string | null
  vehicle_color?: string | null
  body_type?: string | null
  vehicle_body_type?: string | null
  vehicle_make?: string | null
  vehicle_model?: string | null
  /** The photo the SERVER resolved for this car (approved in the review page). */
  vehicle_image_url?: string | null
  image_url?: string | null
} | null): VehicleImageSpec {
  const make = String(vehicle?.make || vehicle?.vehicle_make || '').trim()
  const model = String(vehicle?.model || vehicle?.vehicle_model || '').trim()
  const colour = colourNameOf(vehicle?.colour || vehicle?.vehicle_color)

  // 0. a PHOTO THE SERVER RESOLVED for this car — an approved, background-removed
  //    copy stored in our own bucket. It outranks everything below: it is a real
  //    car, in the driver's colour, approved by a human. (Served by
  //    GET /api/vehicle-images/<file>.webp, never hotlinked from a third party.)
  // The URL is absolutised before use. When PUBLIC_API_BASE is unset the server
  // sends a path like /api/vehicle-images/x.webp, and inside the WebView that
  // resolved to https://localhost/api/... (the app's own bundle server, which has
  // no such file), so the photo never appeared. absoluteApiUrl() prefixes the API
  // host, so the card shows the photo regardless of how the server is configured.
  const serverUrl = absoluteApiUrl(vehicle?.vehicle_image_url || vehicle?.image_url)
  if (serverUrl) return { type: 'url', url: serverUrl }

  // 1. a real photo for this exact car, if one was generated
  const images = ((photoMap as any)?.images || {}) as Record<string, string>
  if (make && model) {
    const url = images[`${make}|${model}|${colour}`]
    if (url) return { type: 'url', url }
  }

  // 2. NO PHOTO ON FILE - the car is drawn as a NEUTRAL PLACEHOLDER, never painted in
  //    the driver's colour. A red silhouette sitting where a photo belongs reads as
  //    "this is your driver's car", and it is not: it is a shape we guessed. Neutrally
  //    grey, it is unmistakably a placeholder, and the card's own text still names the
  //    real colour, make and model. (Before this, `colour` was passed in here.)
  return {
    type: 'svg',
    bodyType: normaliseBody(vehicle?.body_type || vehicle?.vehicle_body_type),
  }
}


