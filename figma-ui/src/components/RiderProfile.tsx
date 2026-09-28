import { useEffect, useRef, useState } from 'react'
import { Header } from './SettingsScreen'
import {
  DOC_LABELS,
  getMyDocuments,
  getStoredProfileInfo,
  getStoredUser,
  updateMyProfile,
  uploadDocument,
  type DocRow,
} from '../lib/backend'

/** Reads a picked file as a base64 data URL — the format the upload API takes. */
function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader()
    fr.onload = () => resolve(String(fr.result))
    fr.onerror = () => reject(new Error('Could not read that file'))
    fr.readAsDataURL(file)
  })
}

/**
 * Your Details — name, phone and ID document.
 *
 * Two things asked for on 27 Sep 2026: "inside Settings have a user's details
 * profile and a section they can upload their ID document". Name and phone save
 * through the same upsert the app runs at launch (POST /api/users/sync) —
 * deliberately WITHOUT `role`, which is how a driver account used to get
 * downgraded to passenger. The ID goes to POST /api/documents/upload as type
 * `id_document` (one of the server's accepted types) and appears below with its
 * review status.
 */
export default function RiderProfile({ onBack }: { onBack: () => void }) {
  const [user] = useState<any>(() => getStoredUser())
  const [cached] = useState(() => getStoredProfileInfo())

  const [name, setName] = useState(() => cached.full_name || '')
  const [phone, setPhone] = useState(() => cached.phone || '')
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')

  const [docs, setDocs] = useState<DocRow[]>([])
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement | null>(null)

  async function refreshDocs() {
    const d = await getMyDocuments().catch(() => null)
    setDocs(Array.isArray(d?.documents) ? (d as any).documents : [])
  }
  useEffect(() => { void refreshDocs() }, [])

  async function save() {
    setSaving(true)
    setMsg('')
    try {
      await updateMyProfile({
        ...(name.trim() ? { full_name: name.trim() } : {}),
        ...(phone.trim() ? { phone: phone.trim() } : {}),
      })
      setMsg('Saved.')
    } catch (e: any) {
      setMsg(e?.message || 'Could not save your details.')
    } finally {
      setSaving(false)
    }
  }

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    setMsg('')
    try {
      const data = await readAsDataUrl(file)
      await uploadDocument('id_document', file.name, file.type || 'image/jpeg', data)
      await refreshDocs()
      setMsg('ID uploaded — it shows as Pending until it is reviewed.')
    } catch (err: any) {
      setMsg(err?.message || 'Could not upload that document.')
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const email = user?.email || 'Not signed in'

  return (
    <div className="flex flex-col h-screen bg-[#F7F7F7]">
      <Header title="Your Details" sub="Profile and identity documents" onBack={onBack} />
      <div className="flex-1 overflow-y-auto px-4 py-4 pb-24">
        <div className="bg-white rounded-2xl border border-[#F0F0F0] p-4 shadow-sm">
          <p className="text-[11px] uppercase tracking-widest text-[#ADADAD] font-semibold mb-3">Profile</p>

          <label className="block text-[11px] text-[#6B6B6B] font-semibold mb-1">Full name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Thandi Mokoena"
            className="w-full rounded-xl border border-[#E8E8E8] bg-white px-3.5 py-3 text-[14px] text-[#1A1A1A] outline-none focus:border-[#1A1A1A]"
          />

          <label className="block text-[11px] text-[#6B6B6B] font-semibold mb-1 mt-3">Phone number</label>
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+27 82 111 2222"
            inputMode="tel"
            className="w-full rounded-xl border border-[#E8E8E8] bg-white px-3.5 py-3 text-[14px] text-[#1A1A1A] outline-none focus:border-[#1A1A1A]"
          />

          <label className="block text-[11px] text-[#6B6B6B] font-semibold mb-1 mt-3">Email</label>
          <p className="text-[14px] text-[#6B6B6B] px-1 py-2">{email}</p>

          <button
            onClick={save}
            disabled={saving}
            className="mt-3 w-full bg-[#EA4335] active:bg-[#C5221F] disabled:opacity-60 text-white font-semibold text-[14px] py-3.5 rounded-2xl"
          >
            {saving ? 'Saving…' : 'Save details'}
          </button>
        </div>

        <div className="bg-white rounded-2xl border border-[#F0F0F0] p-4 mt-3 shadow-sm">
          <p className="text-[11px] uppercase tracking-widest text-[#ADADAD] font-semibold mb-1">Identity document</p>
          <p className="text-[12px] text-[#6B6B6B] leading-relaxed">
            Upload a clear photo or PDF of your ID, passport or driver's licence. It is stored
            privately and only used to verify you.
          </p>

          <input
            ref={fileRef}
            type="file"
            accept="image/*,application/pdf"
            onChange={onPick}
            className="hidden"
          />
          <button
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className={`mt-3 w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl border-2 border-dashed font-semibold text-[13px] ${
              uploading
                ? 'border-[#F2F2F2] bg-[#F7F7F7] text-[#ADADAD]'
                : 'border-[#E8E8E8] bg-white text-[#1A1A1A] active:bg-[#F7F7F7]'
            }`}
          >
            {uploading && <span className="w-4 h-4 rounded-full border-2 border-[#D0D0D0] border-t-[#EA4335] animate-spin" />}
            {uploading ? 'Uploading…' : 'Upload ID document'}
          </button>

          {docs.length > 0 && (
            <div className="mt-3 border-t border-[#F5F5F5]">
              {docs.map((d) => (
                <div key={d.id} className="flex items-center justify-between py-2.5 border-b border-[#F8F8F8] last:border-b-0">
                  <div className="min-w-0 pr-2">
                    <p className="text-[13px] font-semibold text-[#1A1A1A]">
                      {DOC_LABELS[d.doc_type] || d.doc_type}
                    </p>
                    <p className="text-[11px] text-[#ADADAD] truncate">{d.file_name}</p>
                  </div>
                  <span className={`text-[11px] font-semibold shrink-0 ${
                    d.status === 'approved' ? 'text-[#34A853]' : d.status === 'rejected' ? 'text-[#EA4335]' : 'text-[#FBBC04]'
                  }`}>
                    {d.status === 'approved' ? '✓ Verified' : d.status === 'pending_review' ? 'Pending review' : d.status}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {!!msg && <p className="text-[12px] text-[#6B6B6B] font-medium mt-3 leading-snug">{msg}</p>}
      </div>
    </div>
  )
}
