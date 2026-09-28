import { useMemo, useState } from 'react'
import { countries, Country } from '../lib/countries'

/**
 * Country code selector — the web port of the native app's
 * components/CountrySelect.tsx. Same 240-country list (../lib/countries), the
 * same search-by-name-or-dial-code behaviour, the same flag + dial code button,
 * and a full-screen picker with a back arrow. Defaults to South Africa (+27).
 */
export default function CountrySelect({
  value,
  onChange,
}: {
  value: string
  onChange: (dialCode: string) => void
}) {
  const [visible, setVisible] = useState(false)
  const [query, setQuery] = useState('')

  const sorted = useMemo(
    () => [...countries].sort((a, b) => a.name.localeCompare(b.name)),
    []
  )

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return sorted
    return sorted.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.dial_code.replace(/\s/g, '').includes(q.replace(/\s/g, ''))
    )
  }, [sorted, query])

  const selected = sorted.find((c) => c.dial_code === value)

  return (
    <>
      <button
        type="button"
        onClick={() => setVisible(true)}
        className="h-11 rounded-xl bg-[#F7F7F7] border border-[#EBEBEB] flex items-center justify-center gap-1.5 px-3 shrink-0"
      >
        <span className="text-[14px] font-bold text-[#1A1A1A] whitespace-nowrap">
          {selected ? `${selected.flag} ${selected.dial_code}` : value}
        </span>
        {IC.chevDown()}
      </button>

      {visible && (
        <div className="fixed inset-0 z-[999] bg-white flex flex-col">
          {/* Header */}
          <div className="flex items-center gap-3 px-4 pt-4 pb-3 border-b border-[#EEE]">
            <button
              type="button"
              onClick={() => setVisible(false)}
              className="w-9 h-9 rounded-full bg-[#F3F1EE] flex items-center justify-center shrink-0"
            >
              {IC.back()}
            </button>
            <span className="flex-1 text-[17px] font-bold text-[#2E1E1A]">Select country</span>
          </div>

          {/* Search */}
          <div className="mx-4 mt-3 mb-2 flex items-center gap-2.5 bg-[#F3F1EE] rounded-xl px-3 h-11">
            {IC.search()}
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search country or code"
              className="flex-1 bg-transparent text-[15px] text-[#2E1E1A] outline-none placeholder:text-[#80716B]"
              autoComplete="off"
            />
            {query ? (
              <button type="button" onClick={() => setQuery('')} className="shrink-0">
                {IC.closeCircle()}
              </button>
            ) : null}
          </div>

          {/* List */}
          <div className="flex-1 overflow-y-auto pb-8">
            {filtered.length === 0 ? (
              <p className="text-center pt-14 text-[15px] text-[#80716B]">
                No countries match "{query}"
              </p>
            ) : (
              filtered.map((item: Country) => {
                const isSelected = item.dial_code === value
                return (
                  <button
                    key={item.code}
                    type="button"
                    onClick={() => {
                      onChange(item.dial_code)
                      setVisible(false)
                      setQuery('')
                    }}
                    className="w-full flex items-center gap-3.5 py-3.5 px-5 text-left"
                    style={{ backgroundColor: isSelected ? '#FDEEE9' : '#FFFFFF' }}
                  >
                    <span className="text-[22px]">{item.flag}</span>
                    <span
                      className="flex-1 text-[15px] text-[#2E1E1A]"
                      style={{ fontWeight: isSelected ? 700 : 500 }}
                    >
                      {item.name}
                    </span>
                    <span className="text-[15px] font-semibold text-[#80716B]">
                      {item.dial_code}
                    </span>
                    {isSelected ? IC.check() : null}
                  </button>
                )
              })
            )}
          </div>
        </div>
      )}
    </>
  )
}

/** Local inline icons so the selector stays dependency-free. */
const IC = {
  chevDown: () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#80716B" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  ),
  back: () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#2E1E1A" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="19" y1="12" x2="5" y2="12" />
      <polyline points="12 19 5 12 12 5" />
    </svg>
  ),
  search: () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#80716B" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  ),
  closeCircle: () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#80716B" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="15" y1="9" x2="9" y2="15" />
      <line x1="9" y1="9" x2="15" y2="15" />
    </svg>
  ),
  check: () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#E04E2F" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  ),
}