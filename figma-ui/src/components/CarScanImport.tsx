import { useRef, useState } from 'react'
import {
  CarScanFields,
  CarScanResult,
  CarScanStage,
  readCarScan,
  readOdometerByOcr,
} from '../lib/carscan'

/**
 * "Read my CarScan report" — the card that sits above the Link-your-car inputs.
 *
 * The driver picks the PDF (or a photo) of the report their CarScan / Scans.ai
 * inspection produced; this reads it and fills the form, so the plate, VIN and
 * model can never drift from the car the report describes. The file is also
 * handed straight to the carscan_report document slot by the parent, so one pick
 * both fills the form and queues the upload.
 *
 * Everything found is shown before it is applied, and the values stay editable
 * afterwards — the report is the source, not the boss.
 */

/** The report's fields, in the order they are worth reading. */
const SUMMARY: { key: keyof CarScanFields; label: string; mono?: boolean }[] = [
  { key: 'make', label: 'Make' },
  { key: 'model', label: 'Model' },
  { key: 'year', label: 'Year' },
  { key: 'color', label: 'Colour' },
  { key: 'plate', label: 'Number plate', mono: true },
  { key: 'vin', label: 'VIN', mono: true },
  { key: 'engineNumber', label: 'Engine no.', mono: true },
  { key: 'odometer', label: 'Odometer (km)' },
  { key: 'type', label: 'Body' },
  { key: 'licenceNumber', label: 'Licence disc no.', mono: true },
  { key: 'licenceExpiry', label: 'Disc expiry' },
  { key: 'verification', label: 'Verification' },
]

export default function CarScanImport({
  onApply,
  onFile,
  disabled,
}: {
  /** Puts the report's values into the form (the driver can still edit them). */
  onApply: (fields: CarScanFields) => void
  /** The same file, so the parent can queue it as the carscan_report upload. */
  onFile: (file: File) => void
  disabled?: boolean
}) {
  const [file, setFile] = useState<File | null>(null)
  const [stage, setStage] = useState<CarScanStage | 'idle'>('idle')
  const [result, setResult] = useState<CarScanResult | null>(null)
  const [error, setError] = useState('')
  const [applied, setApplied] = useState(false)
  const [showText, setShowText] = useState(false)
  const [odometer, setOdometer] = useState<'idle' | 'busy' | 'done'>('idle')
  const inputRef = useRef<HTMLInputElement | null>(null)

  const busy = stage === 'pdf-text' || stage === 'ocr'

  async function run(f: File) {
    setFile(f)
    setResult(null)
    setError('')
    setApplied(false)
    setOdometer('idle')
    onFile(f)
    try {
      const read = await readCarScan(f, setStage)
      setResult(read)
      // Auto-fill whenever the report gave us anything: that is the whole point
      // of the card. Anything missing stays blank for the driver to type.
      const filled = Object.fromEntries(
        Object.entries(read.fields).filter(([, v]) => !!v),
      ) as CarScanFields
      if (Object.keys(filled).length > 0) {
        onApply(filled)
        setApplied(true)
      }
    } catch (e: any) {
      setError(
        e?.message ||
          'Could not read that report. Fill the details in below and upload the file — our team can check it by hand.',
      )
    } finally {
      setStage('idle')
    }
  }

  async function runOdometer() {
    if (!file) return
    setOdometer('busy')
    try {
      const km = await readOdometerByOcr(file)
      if (km) {
        onApply({ odometer: km })
        setResult((r) => (r ? { ...r, fields: { ...r.fields, odometer: km } } : r))
      } else {
        setError('The odometer was not readable in the report photos — please type it in.')
      }
    } catch {
      setError('Reading the odometer needs a connection the first time it runs — type the reading instead.')
    } finally {
      setOdometer('done')
    }
  }

  const found = result ? SUMMARY.filter((row) => !!result.fields[row.key]) : []
  const missing = result ? SUMMARY.filter((row) => !result.fields[row.key]) : []
  const odometerMissing = !!result && !result.fields.odometer

  return (
    <section className="rounded-2xl border border-[#F0F0F0] bg-white p-4 shadow-sm">
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-xl bg-[#FEF0EF] border border-[#F8D7D4] flex items-center justify-center shrink-0">
          <span className="text-[15px]">📄</span>
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-[13px] font-bold text-[#1A1A1A]">Read my CarScan report</h3>
          <p className="text-[11px] text-[#6B6B6B] mt-0.5 leading-snug">
            Choose the PDF from CarScan (or a clear photo of it) and the make, model, year, colour,
            VIN and number plate fill themselves in below.
          </p>
        </div>
      </div>

      <button
        type="button"
        disabled={disabled || busy}
        onClick={() => inputRef.current?.click()}
        className="mt-3 w-full h-11 rounded-xl bg-[#1A1A1A] text-white text-[13px] font-semibold active:opacity-90 disabled:opacity-60"
      >
        {busy
          ? stage === 'ocr' ? 'Reading the photos…' : 'Reading your report…'
          : file ? 'Choose a different report' : 'Choose CarScan report'}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          // Reset so picking the same file again still fires onChange.
          e.target.value = ''
          if (f) void run(f)
        }}
      />

      {file && <p className="text-[10px] text-[#ADADAD] mt-2 truncate">Queued as your CarScan report: {file.name}</p>}

      {busy && (
        <div className="mt-3 flex items-center gap-2.5">
          <div className="w-3.5 h-3.5 rounded-full border-2 border-[#E0E0E0] border-t-[#EA4335] animate-spin" />
          <span className="text-[11px] text-[#6B6B6B]">
            {stage === 'ocr'
              ? 'Reading the pictures in the report — the first run also downloads the reader.'
              : 'Finding the vehicle details in the report…'}
          </span>
        </div>
      )}

      {error && <p className="text-[11px] text-[#C5221F] font-medium mt-3 leading-snug">{error}</p>}

      {result && found.length > 0 && (
        <div className="mt-3 rounded-xl border border-[#E6F4EA] bg-[#F6FBF7] p-3">
          <p className="text-[11px] font-bold text-[#137333]">
            {applied ? 'Filled in from your report — please check' : 'Found in your report'}
            <span className="font-medium">
              {' · '}
              {result.source === 'ocr' ? 'read from the pictures' : 'read from the PDF'}
            </span>
          </p>
          <div className="mt-2 space-y-1">
            {found.map((row) => (
              <div key={String(row.key)} className="flex items-center justify-between gap-3">
                <span className="text-[11px] text-[#6B6B6B]">{row.label}</span>
                <span className={`text-[11px] font-semibold text-[#1A1A1A] ${row.mono ? 'font-mono tracking-tight' : ''}`}>
                  {result.fields[row.key]}
                </span>
              </div>
            ))}
          </div>
          {missing.length > 0 && (
            <p className="text-[10px] text-[#6B6B6B] mt-2.5 leading-snug">
              Not in the report: {missing.map((m) => m.label).join(', ')} — type those in.
            </p>
          )}
        </div>
      )}

      {result && found.length === 0 && (
        <p className="text-[11px] text-[#B06000] font-medium mt-3 leading-snug">
          Nothing readable came out of that file. It is queued as your CarScan report — please type
          the details in below.
        </p>
      )}

      {odometerMissing && (
        <button
          type="button"
          disabled={odometer === 'busy'}
          onClick={runOdometer}
          className="mt-2.5 w-full h-10 rounded-xl border border-[#EBEBEB] bg-[#F7F7F7] text-[11px] font-semibold text-[#1A1A1A] active:bg-[#EFEFEF] disabled:opacity-60"
        >
          {odometer === 'busy'
            ? 'Reading the dash photos…'
            : 'Read the odometer from the photos (slower)'}
        </button>
      )}

      {result && result.text && (
        <>
          <button
            type="button"
            onClick={() => setShowText((v) => !v)}
            className="mt-2.5 text-[10px] font-semibold text-[#6B6B6B] underline"
          >
            {showText ? 'Hide what was read' : 'See what was read'}
          </button>
          {showText && (
            <pre className="mt-2 max-h-40 overflow-auto rounded-xl bg-[#F7F7F7] border border-[#EBEBEB] p-2.5 text-[10px] leading-snug text-[#4A4A4A] whitespace-pre-wrap break-words">
              {result.text}
            </pre>
          )}
        </>
      )}
    </section>
  )
}
