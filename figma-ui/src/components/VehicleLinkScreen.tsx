import { useEffect, useRef, useState } from 'react'
import {
  DOC_LABELS,
  DocRow,
  DocumentType,
  getMyDocuments,
  saveVehicle,
  uploadDocument,
} from '../lib/backend'
import CarScanImport from './CarScanImport'
import type { CarScanFields } from '../lib/carscan'

/**
 * "Link your car" — the web port of the native app's app/driver/vehicle.tsx.
 *
 * It does the two things that screen does:
 *   1. Captures the vehicle details (make, model, year, colour, type, plate,
 *      licence number, VIN, odometer), kept on the device exactly like the
 *      native app stores them (AsyncStorage key "vura.vehicle.linked" — here
 *      the web equivalent, localStorage under the same key).
 *   2. Uploads the driver's documents to the same endpoints, so anything sent
 *      from here reaches the admin review queue and the native app alike:
 *        GET  /api/documents/mine    -> previously uploaded docs
 *        POST /api/documents/upload  -> { type, fileName, mimeType, data }
 */

/** The document slots the driver can upload, in the native app's order. */
const DRIVER_DOCS: DocumentType[] = [
  'drivers_license',
  'id_document',
  'prdp',
  'criminal_record',
]
const VEHICLE_DOCS: DocumentType[] = ['license_disk', 'carscan_report']

const LINKED_KEY = 'vura.vehicle.linked'

type LinkedVehicle = {
  make: string
  model: string
  year: string
  color: string
  type: string
  plate: string
  licenseNumber: string
  vin: string
  odometer: string
  linkedAt: string
}

const EMPTY: LinkedVehicle = {
  make: '', model: '', year: '', color: '', type: '',
  plate: '', licenseNumber: '', vin: '', odometer: '', linkedAt: '',
}

type Picked = Partial<Record<DocumentType, { name: string; mime: string; data: string; size: number }>>

/** Reads a picked file as a base64 data URL — the format the upload API takes. */
function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(new Error('Could not read that file'))
    reader.readAsDataURL(file)
  })
}

export default function VehicleLinkScreen({ onBack }: { onBack: () => void }) {
  const [vehicle, setVehicle] = useState<LinkedVehicle>(EMPTY)
  const [docs, setDocs] = useState<DocRow[]>([])
  // Locally picked files, keyed by document type, waiting to be uploaded.
  const [picked, setPicked] = useState<Picked>({})
  const [uploading, setUploading] = useState<DocumentType | null>(null)
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState('')
  const [error, setError] = useState('')

  // Hydrate the last linked car from this device, then pull the driver's real
  // documents from the server so anything uploaded in the native app shows up.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(LINKED_KEY)
      if (raw) setVehicle({ ...EMPTY, ...(JSON.parse(raw) as LinkedVehicle) })
    } catch { /* ignore a corrupt record */ }
    void refreshDocs()
  }, [])

  async function refreshDocs() {
    try {
      const res = await getMyDocuments()
      setDocs(res?.documents || [])
      setError('')
    } catch (e: any) {
      // Show the real reason (network, auth, server) rather than an empty list.
      setError(`Could not load your documents: ${e?.message || 'unknown error'}`)
    }
  }

  function set<K extends keyof LinkedVehicle>(key: K, value: string) {
    setVehicle((v) => ({ ...v, [key]: value }))
  }

  /**
   * The values read out of the driver's CarScan report (components/CarScanImport).
   *
   * Only the fields this form actually shows are taken, and only when the report
   * had them — anything it left out keeps whatever the driver had typed. The
   * report's "Licence No." is the VEHICLE licence disc number, so it deliberately
   * does not go into the driver-licence field; it stays in the summary card.
   */
  function applyScan(fields: CarScanFields) {
    setVehicle((v) => ({
      ...v,
      make: fields.make ?? v.make,
      model: fields.model ?? v.model,
      year: fields.year ?? v.year,
      color: fields.color ?? v.color,
      plate: fields.plate ?? v.plate,
      vin: fields.vin ?? v.vin,
      odometer: fields.odometer ?? v.odometer,
      type: fields.type ?? v.type,
    }))
    setToast('Details filled from your CarScan report — please check them')
  }

  /** Latest document already on file for a given type, if any. */
  function existing(type: DocumentType): DocRow | undefined {
    return docs.find((d) => d.doc_type === type)
  }

  async function onPick(type: DocumentType, file: File | undefined) {
    if (!file) return
    setError('')
    try {
      const data = await readAsDataUrl(file)
      setPicked((p) => ({
        ...p,
        [type]: {
          name: file.name,
          mime: file.type || 'application/octet-stream',
          data,
          size: file.size,
        },
      }))
    } catch (e: any) {
      setError(e?.message || 'Could not read that file')
    }
  }

  /** Uploads one document — identical call to the native uploadDocumentToS3(). */
  async function uploadOne(type: DocumentType) {
    const file = picked[type]
    if (!file) return
    setUploading(type)
    setError('')
    try {
      await uploadDocument(type, file.name, file.mime, file.data)
      setPicked((p) => {
        const next = { ...p }
        delete next[type]
        return next
      })
      await refreshDocs()
      setToast(`${DOC_LABELS[type]} uploaded — pending review`)
    } catch (e: any) {
      setError(e?.message || `Could not upload ${DOC_LABELS[type]}`)
    } finally {
      setUploading(null)
    }
  }

  async function uploadAll() {
    const types = (Object.keys(picked) as DocumentType[]).filter((t) => picked[t])
    if (types.length === 0) return
    setBusy(true)
    setError('')
    let done = 0
    for (const t of types) {
      try {
        const f = picked[t]!
        await uploadDocument(t, f.name, f.mime, f.data)
        done++
      } catch (e: any) {
        setError(e?.message || `Could not upload ${DOC_LABELS[t]}`)
      }
    }
    setPicked({})
    await refreshDocs()
    setBusy(false)
    setToast(done === 1
      ? '1 document uploaded — pending review'
      : `${done} documents uploaded — pending review`)
  }

  /** Saves the car to the server (PATCH /api/drivers/profile) AND this device,
   *  then uploads any pending documents.
   *
   *  The server write is what makes the car visible to the rest of the app — the
   *  Account card and every ride the driver takes read driver_profiles — so a
   *  failed PATCH is reported instead of silently pretending the car is linked. */
  async function submit() {
    if (!vehicle.make.trim() || !vehicle.plate.trim()) {
      setError('Make and number plate are required')
      return
    }
    setBusy(true)
    setError('')
    try {
      await saveVehicle({
        make: vehicle.make,
        model: vehicle.model,
        year: vehicle.year,
        color: vehicle.color,
        plate: vehicle.plate,
        type: vehicle.type,
        vin: vehicle.vin,
        odometer: vehicle.odometer,
        licenseNumber: vehicle.licenseNumber,
      })
    } catch (e: any) {
      setError(e?.message || 'Could not save your car to the server')
      setBusy(false)
      return
    }
    try {
      localStorage.setItem(
        LINKED_KEY,
        JSON.stringify({ ...vehicle, linkedAt: new Date().toISOString() })
      )
    } catch { /* storage may be unavailable in a private window */ }
    if (Object.keys(picked).length > 0) await uploadAll()
    else setToast('Car linked')
    setBusy(false)
  }

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(''), 3500)
    return () => clearTimeout(t)
  }, [toast])

  return (
    <div className="h-full overflow-y-auto bg-white pb-32">
      {/* Header */}
      <div className="sticky top-0 z-20 bg-white flex items-center gap-3 px-4 py-3 border-b border-[#F0F0F0]">
        <button onClick={onBack} className="w-9 h-9 rounded-full border border-[#EBEBEB] flex items-center justify-center shrink-0 active:bg-[#F7F7F7]">
          {IC.back()}
        </button>
        <div className="flex-1">
          <h2 className="text-[16px] font-bold text-[#1A1A1A]">Link your car</h2>
          <p className="text-[11px] text-[#ADADAD]">Add your vehicle and upload your documents</p>
        </div>
      </div>

      <div className="px-4 pt-4 space-y-5">
        {toast && (
          <div className="rounded-xl bg-[#E6F4EA] border border-[#CEEAD6] px-4 py-3 text-[12px] font-semibold text-[#137333]">{toast}</div>
        )}
        {error && (
          <div className="rounded-xl bg-[#FCE8E6] border border-[#F5C6C2] px-4 py-3 text-[12px] font-semibold text-[#C5221F]">{error}</div>
        )}

        {/* ── CarScan report: fills the form from the driver's own report ── */}
        {/* Deliberately the first thing on the screen — everything under it is
            then a check of what the report said, not a memory test. */}
        <CarScanImport
          onApply={applyScan}
          // The same file is queued for the carscan_report upload, so one pick
          // both fills the form and sends the report to the review team.
          onFile={(f) => void onPick('carscan_report', f)}
          disabled={busy}
        />

        {/* ── Vehicle details ─────────────────────────────────────────── */}
        <section>
          <h3 className="text-[11px] uppercase tracking-widest text-[#ADADAD] font-semibold mb-2">Vehicle details</h3>
          <div className="space-y-2.5">
            <Row label="Make" value={vehicle.make} onChange={(v) => set('make', v)} placeholder="Toyota" />
            <Row label="Model" value={vehicle.model} onChange={(v) => set('model', v)} placeholder="Corolla Quest" />
            <div className="flex gap-2.5">
              <div className="flex-1"><Row label="Year" value={vehicle.year} onChange={(v) => set('year', v.replace(/\D/g, '').slice(0, 4))} placeholder="2021" /></div>
              <div className="flex-1"><Row label="Colour" value={vehicle.color} onChange={(v) => set('color', v)} placeholder="White" /></div>
            </div>
            <div className="flex gap-2.5">
              <div className="flex-1"><Row label="Number plate" value={vehicle.plate} onChange={(v) => set('plate', v.toUpperCase())} placeholder="CA 123 456" /></div>
              <div className="flex-1"><Row label="Odometer (km)" value={vehicle.odometer} onChange={(v) => set('odometer', v.replace(/\D/g, ''))} placeholder="82000" /></div>
            </div>
            <Row label="Licence number" value={vehicle.licenseNumber} onChange={(v) => set('licenseNumber', v)} placeholder="Your driving licence no." />
            <Row label="VIN" value={vehicle.vin} onChange={(v) => set('vin', v.toUpperCase())} placeholder="17-character VIN" />
          </div>
        </section>

        {/* ── Driver documents ────────────────────────────────────────── */}
        <section>
          <h3 className="text-[11px] uppercase tracking-widest text-[#ADADAD] font-semibold mb-2">Your documents</h3>
          <div className="rounded-2xl border border-[#F0F0F0] overflow-hidden divide-y divide-[#F5F5F5]">
            {DRIVER_DOCS.map((t) => (
              <DocSlot
                key={t}
                type={t}
                file={picked[t]}
                onFile={(f) => onPick(t, f)}
                onUpload={() => uploadOne(t)}
                uploading={uploading === t}
                existing={existing(t)}
              />
            ))}
          </div>
        </section>

        {/* ── Vehicle documents ──────────────────────────────────────── */}
        <section>
          <h3 className="text-[11px] uppercase tracking-widest text-[#ADADAD] font-semibold mb-2">Vehicle documents</h3>
          <div className="rounded-2xl border border-[#F0F0F0] overflow-hidden divide-y divide-[#F5F5F5]">
            {VEHICLE_DOCS.map((t) => (
              <DocSlot
                key={t}
                type={t}
                file={picked[t]}
                onFile={(f) => onPick(t, f)}
                onUpload={() => uploadOne(t)}
                uploading={uploading === t}
                existing={existing(t)}
              />
            ))}
          </div>

          {/* CarScan report only — the driver supplies the report; the 8-angle
              in-app scan window has been removed as requested. */}
        </section>

        {/* ── Submit ─────────────────────────────────────────────────── */}
        <button
          onClick={submit}
          disabled={busy}
          className="w-full h-12 rounded-2xl bg-[#EA4335] text-white text-[14px] font-bold active:opacity-90 disabled:opacity-60"
        >
          {busy
            ? 'Uploading…'
            : Object.keys(picked).length > 0
              ? `Link car & upload ${Object.keys(picked).length} document${Object.keys(picked).length > 1 ? 's' : ''}`
              : 'Link car'}
        </button>
        <p className="text-[11px] text-[#ADADAD] text-center -mt-2">
          Documents are reviewed by our team — you'll be notified once approved.
        </p>
      </div>
    </div>
  )
}

/**
 * One document row: shows what is already on file (real file name + review
 * status pulled from the server), lets the driver pick a replacement, and
 * uploads it immediately to POST /api/documents/upload.
 */
function DocSlot({
  type, file, onFile, onUpload, uploading, existing,
}: {
  type: DocumentType
  file?: { name: string; mime: string; data: string; size: number }
  onFile: (f: File | undefined) => void
  onUpload: () => void
  uploading: boolean
  existing?: DocRow
}) {
  const inputId = `doc-${type}`
  // A ref + direct click() is the most reliable way to open the Android file
  // chooser from inside a Capacitor WebView (a <label htmlFor> forward can be
  // swallowed), so the picker is triggered explicitly.
  const inputRef = useRef<HTMLInputElement | null>(null)
  return (
    <div className="flex items-center gap-2.5 px-3.5 py-3">
      <div className="flex-1 min-w-0">
        <p className="text-[13px] text-[#1A1A1A]">{DOC_LABELS[type]}</p>
        {file ? (
          <p className="text-[11px] text-[#EA4335] mt-0.5 truncate">{file.name} — ready to upload</p>
        ) : existing ? (
          <p className="text-[11px] text-[#ADADAD] mt-0.5 truncate">{existing.file_name}</p>
        ) : (
          <p className="text-[11px] text-[#C4C4C4] mt-0.5">Not uploaded yet</p>
        )}
      </div>

      {existing && !file && (
        <span
          className={
            'text-[10px] font-semibold px-2 py-1 rounded-full shrink-0 ' +
            (existing.status === 'approved'
              ? 'bg-[#E6F4EA] text-[#137333]'
              : existing.status === 'rejected'
                ? 'bg-[#FCE8E6] text-[#C5221F]'
                : 'bg-[#FEF7E0] text-[#B06000]')
          }
        >
          {existing.status === 'approved' ? '✓ Verified' : existing.status.replace(/_/g, ' ')}
        </span>
      )}

      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className="shrink-0 h-8 px-3 rounded-lg bg-[#F7F7F7] border border-[#EBEBEB] text-[11px] font-semibold text-[#1A1A1A] active:bg-[#EFEFEF]"
      >
        Choose
      </button>
      <input
        id={inputId}
        ref={inputRef}
        type="file"
        accept="image/*,application/pdf"
        className="hidden"
        onChange={(e) => {
          onFile(e.target.files?.[0])
          // Reset so picking the same file again still fires onChange.
          e.target.value = ''
        }}
      />

      {file && (
        <button
          onClick={onUpload}
          disabled={uploading}
          className="shrink-0 h-8 px-3 rounded-lg bg-[#EA4335] text-[11px] font-semibold text-white active:opacity-90 disabled:opacity-60"
        >
          {uploading ? '…' : 'Upload'}
        </button>
      )}
    </div>
  )
}

/** Small labelled text input. */
function Row({
  label, value, onChange, placeholder,
}: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div>
      <label className="block text-[11px] font-medium text-[#4A4A4A] mb-1 ml-0.5">{label}</label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full h-10 rounded-xl bg-[#F7F7F7] border border-[#EBEBEB] px-3 text-[13px] text-[#1A1A1A] outline-none focus:border-[#EA4335] placeholder:text-[#C4C4C4]"
      />
    </div>
  )
}

const IC = {
  back: () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#1A1A1A" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="19" y1="12" x2="5" y2="12" /><polyline points="12 19 5 12 12 5" />
    </svg>
  ),
  chevRight: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#C4C4C4" strokeWidth="2" strokeLinecap="round">
      <path d="M9 18l6-6-6-6" />
    </svg>
  ),
}