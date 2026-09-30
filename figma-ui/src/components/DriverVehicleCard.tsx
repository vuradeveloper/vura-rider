// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// <DriverVehicleCard /> â€” ONE component for every rider-facing driver/car card, so
// the accepted, arriving, arrived, in-progress, completed and history screens can
// never drift apart.
//
// Layout (Uber-style): stage headline, the car picture with the driver's circular
// photo overlapping its top-left corner, the plate in large letter-spaced type, then
// "<First name> - <Colour> <Make> <Model>" and a Call / Message / more row.
//
// The plate is the real identifier and stays the most prominent text: the drawing
// shows the right SHAPE in the right COLOUR, not the exact model.
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
import { useState } from 'react'
import VehicleImage, { resolveVehicleImage } from './vehicle/VehicleImage'
import { colourNameOf } from './vehicle/palette'

export type TripStage = 'accepted' | 'arriving' | 'arrived' | 'in_progress' | 'completed'

export type DriverInfo = {
  name?: string | null
  photo_url?: string | null
  rating?: number | null
}

export type VehicleInfo = {
  make?: string | null
  model?: string | null
  year?: number | null
  colour?: string | null
  vehicle_color?: string | null
  plate?: string | null
  license_plate?: string | null
  body_type?: string | null
  vehicle_body_type?: string | null
  image_url?: string | null
} | null

export default function DriverVehicleCard({
  driver,
  vehicle,
  stage,
  etaMin,
  compact = false,
  onCall,
  onMessage,
  onMore,
}: {
  driver: DriverInfo
  vehicle: VehicleInfo
  stage: TripStage
  etaMin?: number | null
  compact?: boolean
  onCall?: () => void
  onMessage?: () => void
  onMore?: () => void
}) {
  const [photoFailed, setPhotoFailed] = useState(false)

  const fullName = String(driver?.name || 'Your driver')
  const first = fullName.split(' ')[0]
  const colour = colourNameOf(vehicle?.colour || vehicle?.vehicle_color)
  const make = String(vehicle?.make || '').trim()
  const model = String(vehicle?.model || '').trim()
  const plate = String(vehicle?.plate || vehicle?.license_plate || '').trim()
  const desc = [colour, make, model].filter(Boolean).join(' ') || 'Vehicle details pending'
  const spec = resolveVehicleImage(vehicle)
  const photo = !photoFailed && driver?.photo_url ? String(driver.photo_url) : ''
  const initials =
    fullName.split(' ').map((p) => p[0]).join('').slice(0, 2).toUpperCase() || 'D'

  const headline =
    stage === 'accepted' ? `${first} accepted your ride`
    : stage === 'arriving' ? (etaMin && etaMin > 0 ? `${first} is arriving in ${etaMin} min` : `${first} is on the way`)
    : stage === 'arrived' ? `${first} has arrived`
    : stage === 'in_progress' ? `On the way with ${first}`
    : `${first} completed your trip`

  const carSize = compact ? 130 : 210

  return (
    <div className="bg-white rounded-2xl border border-[#EBEBEB] p-4 mb-3">
      <p className="text-[13px] font-bold text-[#1A1A1A]">{headline}</p>

      <div className="relative mt-2 flex justify-center">
        {/* driver photo overlapping the top-left corner of the car */}
        <div className={`absolute left-0 ${compact ? 'top-4' : 'top-6'} w-12 h-12 rounded-full overflow-hidden border-2 border-white bg-[#1A1A1A] shadow-sm flex items-center justify-center z-10`}>
          {photo ? (
            <img
              src={photo}
              alt={fullName}
              className="w-full h-full object-cover"
              onError={() => setPhotoFailed(true)}
            />
          ) : (
            <span className="text-[15px] font-bold text-white">{initials}</span>
          )}
        </div>

        {spec.type === 'svg' ? (
          <VehicleImage
            bodyType={spec.bodyType}
            colour={vehicle?.colour || vehicle?.vehicle_color}
            size={carSize}
            missing={!make && !model && !plate}
          />
        ) : (
          <img src={spec.url} alt={desc} style={{ width: carSize }} />
        )}
      </div>

      <p
        className={`text-center font-bold text-[#1A1A1A] tracking-[0.28em] ${compact ? 'text-[18px] mt-1' : 'text-[24px] mt-2'}`}
        style={{ fontFamily: 'JetBrains Mono, monospace' }}
      >
        {plate || 'â€”'}
      </p>

      <p className="text-center text-[13px] text-[#4A4A4A] font-semibold mt-1 capitalize">
        {first} Â· {desc}
      </p>
      {driver?.rating ? (
        <p className="text-center text-[12px] text-[#6B6B6B] mt-0.5">
          â˜… {Number(driver.rating).toFixed(2)}
        </p>
      ) : null}

      {!compact && (
        <div className="flex gap-2 mt-3">
          <button
            onClick={onCall}
            className="flex-1 border border-[#EBEBEB] rounded-2xl py-3 text-[13px] font-semibold text-[#1A1A1A] active:bg-[#F7F7F7]"
          >
            Call driver
          </button>
          <button
            onClick={onMessage}
            className="flex-1 border border-[#EBEBEB] rounded-2xl py-3 text-[13px] font-semibold text-[#1A1A1A] active:bg-[#F7F7F7]"
          >
            Message
          </button>
          <button
            onClick={onMore}
            aria-label="More options"
            className="w-12 border border-[#EBEBEB] rounded-2xl py-3 text-[13px] font-semibold text-[#1A1A1A] active:bg-[#F7F7F7]"
          >
            â‹¯
          </button>
        </div>
      )}
    </div>
  )
}
