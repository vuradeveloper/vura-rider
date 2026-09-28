// ─────────────────────────────────────────────────────────────────────────────
// CarScan / Scans.ai inspection report → the "Link your car" form.
//
// WHY THIS EXISTS: a driver's CarScan report already carries the make, model,
// year, colour, VIN and registration number. Retyping them is slow and is how
// plates and VINs end up not matching the car the report describes — so the
// report is read here and the values are offered back to the driver to confirm.
//
// Two readers, tried in order:
//   1. PDF text layer — pdf.js reads the text the report was generated with.
//      Verified against the real report (Downloads/document.pdf): Make KIA,
//      Model PICANTO, Year 2017, Colour Red, VIN KNABE511LHT286190,
//      Registration WYS444W, Engine G3LAGD020036, Licence BV93MHZN.
//   2. OCR — for a scan or a photo, where there is no text layer: the pages are
//      rendered to a canvas and read with Tesseract.
//
// Both libraries are imported lazily, so nothing is downloaded or parsed until a
// driver actually picks a report.
// ─────────────────────────────────────────────────────────────────────────────

/** What the report said, in the form's own field names. Every field is optional. */
export type CarScanFields = {
  make?: string
  model?: string
  year?: string
  color?: string
  /** Body description from the report ("Hatch back") — the app's vehicle type. */
  type?: string
  /** Registration number, i.e. the number plate. */
  plate?: string
  vin?: string
  odometer?: string
  /** Summary only: this is the VEHICLE licence disc number, not the driver's own
   *  licence number, so it is never used to fill the driver-licence field. */
  licenceNumber?: string
  engineNumber?: string
  licenceExpiry?: string
  verification?: string
  exteriorScore?: string
  interiorScore?: string
}

export type CarScanSource = 'pdf-text' | 'ocr'

export type CarScanResult = {
  fields: CarScanFields
  /** Which reader produced the text, so the UI can explain an empty result. */
  source: CarScanSource
  /** How many of make/model/year/colour/plate/VIN were found. */
  matched: number
  /** The text that was read, for the "what did it read?" disclosure. */
  text: string
}

/** The proof fields a driver would expect to come out of the report, in order. */
const CORE: (keyof CarScanFields)[] = ['make', 'model', 'year', 'color', 'plate', 'vin']

export function countMatched(f: CarScanFields): number {
  return CORE.filter((k) => !!f[k]).length
}

/** True for a PDF, false for anything the browser treats as an image. */
export function isPdf(file: File): boolean {
  return file.type === 'application/pdf' || /\.pdf$/i.test(file.name)
}

// ─── Reading the fields out of that text ─────────────────────────────────────
// The labels below appear verbatim on a Scans.ai report; the alternates cover the
// wordings seen on other South African inspection reports. A value is taken from
// the same line ("Make: KIA"), the next line, or — for the VIN — the line ABOVE
// the label, which is where Scans.ai prints it when the field is split.

/** The report's text, one trimmed line per printed row. */
function asRows(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
}

/** Turns "87 456 km" into "87456"; "" when there is no number at all. */
function digitsOnly(s: string): string {
  return (s.replace(/[^\d]/g, '') || '').replace(/^0+/, '')
}

/** True for something that reads as another field's label, not as a value. */
function isAnotherLabel(s: string): boolean {
  return s.length <= 24 && /^[A-Za-z][A-Za-z ./]{2,}:?$/.test(s)
}

/**
 * The value printed for `label`. Looks at the rest of the label's own line, then
 * the two lines under it — a report that lays its fields out in columns, as this
 * one does, prints the value on the line below the label.
 */
function firstValue(rows: string[], label: RegExp, accept?: RegExp): string | undefined {
  for (let i = 0; i < rows.length; i++) {
    const m = label.exec(rows[i])
    if (!m) continue
    const tail = rows[i].slice(m.index + m[0].length).replace(/^[\s:.\-–]+/, '').trim()
    for (const candidate of [tail, rows[i + 1], rows[i + 2]]) {
      const value = (candidate || '').trim()
      if (!value) continue
      if (accept ? !accept.test(value) : isAnotherLabel(value)) continue
      return value
    }
  }
  return undefined
}

/** A VIN is 17 characters and never contains I, O or Q. */
const VIN_SHAPE = /^[A-HJ-NPR-Z0-9]{17}$/

function findVin(rows: string[]): string | undefined {
  const strip = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '')
  const usable = (s: string) => VIN_SHAPE.test(s) && /\d/.test(s) && /[A-Z]/.test(s)

  // 1. Printed as a single word somewhere on the report.
  for (const row of rows) {
    for (const token of row.split(/[^A-Za-z0-9]+/)) {
      if (usable(token.toUpperCase())) return token.toUpperCase()
    }
  }

  // 2. Split around the label itself, which is what the real report does:
  //      KNABE511LHT28   <- value, first half
  //      VIN No.:        <- label, in the middle
  //      6190            <- value, second half
  //    so the halves are rejoined in the orders that skip the label's own text.
  const at = rows.findIndex((r) => /\bvin\b/i.test(r))
  if (at >= 0) {
    const above = strip(rows[at - 1] || '')
    const below = strip(rows[at + 1] || '')
    const below2 = strip(rows[at + 2] || '')
    for (const joined of [above + below, above + below2, below + below2]) {
      for (let i = 0; i + 17 <= joined.length; i++) {
        const window = joined.slice(i, i + 17)
        if (usable(window)) return window
      }
    }
  }
  return undefined
}

/** "Red / Rooi" → "Red"; "White (Pearl)" → "White". */
function firstColour(s: string): string {
  return s.split(/[/,(]/)[0].replace(/\s+/g, ' ').trim()
}

/** Body shapes the app knows, so "Hatch back" is reported as "Hatchback". */
function bodyType(text: string): string | undefined {
  const m = text.match(
    /\b(hatch\s*back|hatchback|sedan|saloon|suv|bakkie|single\s*cab|double\s*cab|crew\s*cab|minibus|van|panel\s*van|station\s*wagon|mpv|coupe|cabriolet|convertible|pickup|bus|truck)\b/i,
  )
  if (!m) return undefined
  const word = m[1].toLowerCase().replace(/\s+/g, '')
  return word === 'hatchback' ? 'Hatchback' : word.charAt(0).toUpperCase() + word.slice(1)
}

/** Pulls every field this module knows how to read out of the report's text. */
export function parseCarScanText(text: string): CarScanFields {
  const rows = asRows(text)
  const fields: CarScanFields = {}

  fields.make = firstValue(rows, /^\s*(?:vehicle\s+)?make\s*[:\-]?\s*/i, /^[A-Za-z][A-Za-z0-9 .\-]{1,20}$/)
  fields.model = firstValue(rows, /^\s*(?:vehicle\s+)?model\s*[:\-]?\s*/i, /^[A-Za-z0-9][A-Za-z0-9 .\-]{0,24}$/)

  const yearText = firstValue(
    rows,
    /^\s*(?:year\s*of\s*vehicle|model\s*year|year)\s*[:\-]?\s*/i,
    /\b(?:19|20)\d{2}\b/,
  )
  if (yearText) {
    const year = Number((yearText.match(/\b((?:19|20)\d{2})\b/) || [])[1])
    // Guard against a score or an expiry date being read as the model year.
    if (year >= 1950 && year <= new Date().getFullYear() + 1) fields.year = String(year)
  }

  const colour = firstValue(rows, /^\s*colou?r\s*[:\-]?\s*/i, /^[A-Za-z][A-Za-z /&(),\-]{2,30}$/)
  if (colour) fields.color = firstColour(colour)

  const plate = firstValue(
    rows,
    /^\s*(?:registration(?:\s*(?:no\.?|number|#))?|reg\.?\s*(?:no\.?|number)?|number\s*plate|licen[cs]e\s*plate)\s*[:\-]?\s*/i,
    /^[A-Z0-9][A-Z0-9\- ]{2,12}$/i,
  )
  if (plate) fields.plate = plate.toUpperCase()

  fields.vin = findVin(rows)
  fields.type = bodyType(text)

  // Odometer: printed beside or under the label when the report carries it at
  // all. On the Scans.ai report it is inside a photo, so this stays empty and the
  // driver either types it or uses the OCR button in the UI.
  const odometerText =
    firstValue(rows, /^\s*(?:odometer|mileage|km\s*reading|kilomet(?:er|re)s?)\s*[:\-]?\s*/i, /\d/) ||
    (text.match(/(?:odometer|mileage)\b[^\d\n]{0,15}(\d[\d ,.]{2,9})/i) || [])[1]
  if (odometerText) {
    const km = digitsOnly(odometerText)
    if (km.length >= 3 && km.length <= 7) fields.odometer = km
  }

  fields.engineNumber = firstValue(
    rows,
    /^\s*engine\s*(?:no\.?|number|#)?\s*[:\-]?\s*/i,
    /^[A-Z0-9][A-Z0-9\-]{4,20}$/i,
  )
  fields.licenceNumber = firstValue(
    rows,
    /^\s*licen[cs]e\s*(?:no\.?|number|#)\s*[:\-]?\s*/i,
    /^[A-Z0-9][A-Z0-9\-]{2,20}$/i,
  )
  fields.licenceExpiry = firstValue(
    rows,
    /^\s*licen[cs]e\s*exp(?:iry)?\s*(?:date)?\s*[:\-]?\s*/i,
    /\b\d{4}-\d{2}-\d{2}\b|\b\d{2}[/-]\d{2}[/-]\d{4}\b/,
  )
  fields.verification = firstValue(rows, /^\s*verification\s*[:\-]?\s*/i, /^[A-Za-z][A-Za-z ]{2,20}$/)

  const score = (which: string) => {
    const m = text.match(new RegExp(`${which}\\s*score\\s*[:\\-]?\\s*(\\d{1,3})`, 'i'))
    return m ? m[1] : undefined
  }
  fields.exteriorScore = score('exterior')
  fields.interiorScore = score('interior')

  return fields
}

// ─── pdf.js ──────────────────────────────────────────────────────────────────
// The parser runs on the MAIN thread instead of in a Web Worker. pdf.js supports
// that — it is the `globalThis.pdfjsWorker` path in PDFWorker.#initialize() — and
// it matters here: inside the Capacitor WebView the page is served from
// https://localhost, where spawning the module worker pdf.js asks for is the one
// step that can silently fail and leave a driver staring at "could not read it".
type Pdfjs = typeof import('pdfjs-dist/legacy/build/pdf.mjs')

let pdfjsPromise: Promise<Pdfjs> | null = null

function loadPdfjs(): Promise<Pdfjs> {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
      // Importing the parser module registers globalThis.pdfjsWorker, which is
      // exactly what makes pdf.js take the main-thread path.
      try {
        await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs')
      } catch {
        /* pdf.js has its own fallback — let getDocument report any failure. */
      }
      return pdfjs
    })()
  }
  return pdfjsPromise
}

/**
 * Opens the report. Returns pdf.js's loading task rather than the document, so
 * the caller can destroy it in a `finally` — that is what releases the parser
 * (pdf.js v6 moved destroy() off the document and onto the task).
 */
async function openPdf(file: File, pdfjs: Pdfjs) {
  // A fresh copy: pdf.js may detach the buffer it is given, and the OCR reader
  // needs those same bytes again afterwards.
  const data = new Uint8Array(await file.arrayBuffer())
  return pdfjs.getDocument({ data, useSystemFonts: false, verbosity: 0 })
}

/** The text of every page, one line per printed row. */
async function pdfText(file: File): Promise<string> {
  const pdfjs = await loadPdfjs()
  const task = await openPdf(file, pdfjs)
  try {
    const pdf = await task.promise
    const out: string[] = []
    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n)
      const content = await page.getTextContent()
      // pdf.js hands over loose strings; grouping them by their baseline y puts
      // the printed rows back together, so "Make: KIA" does not arrive split.
      const rows = new Map<number, string>()
      for (const item of content.items as any[]) {
        const str: string = item?.str
        if (!str) continue
        const y = Math.round(Number(item.transform?.[5] ?? 0))
        rows.set(y, (rows.get(y) || '') + str)
      }
      const lines = [...rows.entries()]
        .sort((a, b) => b[0] - a[0])
        .map(([, s]) => s.replace(/\s+/g, ' ').trim())
        .filter(Boolean)
      out.push(...lines, '')
    }
    return out.join('\n')
  } finally {
    await task.destroy()
  }
}

/** Renders pages to canvases for the OCR reader. */
async function pdfPagesAsCanvas(file: File, maxPages = 2, scale = 2): Promise<HTMLCanvasElement[]> {
  const pdfjs = await loadPdfjs()
  const task = await openPdf(file, pdfjs)
  try {
    const pdf = await task.promise
    const canvases: HTMLCanvasElement[] = []
    const count = Math.min(pdf.numPages, maxPages)
    for (let n = 1; n <= count; n++) {
      const page = await pdf.getPage(n)
      const viewport = page.getViewport({ scale })
      const canvas = document.createElement('canvas')
      canvas.width = Math.floor(viewport.width)
      canvas.height = Math.floor(viewport.height)
      const ctx = canvas.getContext('2d')
      if (!ctx) continue
      // White behind the page: a rendered PDF page is transparent otherwise, and
      // Tesseract reads white-on-black text very badly.
      ctx.fillStyle = '#fff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      await page.render({ canvas, canvasContext: ctx, viewport }).promise
      canvases.push(canvas)
    }
    return canvases
  } finally {
    await task.destroy()
  }
}

// ─── OCR ─────────────────────────────────────────────────────────────────────
/**
 * Reads text out of a picture. Used for a scanned report, a photo of a printed
 * one, or a PDF that turned out to have no text layer at all.
 *
 * Tesseract is imported on demand — it fetches its engine and English language
 * data (a few MB) the first time it runs, so it must never be part of startup.
 * That download is why the UI says "first time takes a moment".
 */
async function ocr(
  source: HTMLCanvasElement | Blob | File,
  onProgress?: (fraction: number) => void,
): Promise<string> {
  const { createWorker } = await import('tesseract.js')
  const worker = await createWorker('eng', undefined, {
    logger: (m: any) => {
      if (m?.status === 'recognizing text') onProgress?.(Number(m.progress || 0))
    },
  })
  try {
    const { data } = await worker.recognize(source as any)
    return String((data as any)?.text || '')
  } finally {
    await worker.terminate()
  }
}

// ─── The entry point the form uses ───────────────────────────────────────────
/** Which reader is running, so the UI can say what it is doing. */
export type CarScanStage = 'pdf-text' | 'ocr'

/** Keeps the raw text small enough to hand to the screen for disclosure. */
function shorten(text: string, max = 4000): string {
  const clean = text.replace(/\n{2,}/g, '\n').trim()
  return clean.length > max ? `${clean.slice(0, max)}\n…` : clean
}

/**
 * Reads a CarScan report and returns the vehicle details in it.
 *
 * A PDF is read from its text layer first: that is fast, exact and needs no
 * network. Only when that yields almost nothing — a scan, or a photo of a printed
 * report — does the slow OCR path run. The caller is told which reader produced
 * the result, so an empty answer is never a mystery.
 */
export async function readCarScan(
  file: File,
  onStage?: (stage: CarScanStage) => void,
): Promise<CarScanResult> {
  if (isPdf(file)) {
    onStage?.('pdf-text')
    let text = ''
    try {
      text = await pdfText(file)
    } catch {
      // A broken or password-protected text layer is not fatal — OCR may still
      // read the pages, so fall through to it rather than failing the read.
      text = ''
    }
    let fields = parseCarScanText(text)
    if (countMatched(fields) >= 2) {
      return { fields, source: 'pdf-text', matched: countMatched(fields), text: shorten(text) }
    }

    onStage?.('ocr')
    let ocrText = ''
    for (const canvas of await pdfPagesAsCanvas(file, 2)) {
      ocrText += `\n${await ocr(canvas)}`
    }
    fields = parseCarScanText(ocrText)
    return { fields, source: 'ocr', matched: countMatched(fields), text: shorten(ocrText) }
  }

  onStage?.('ocr')
  const ocrText = await ocr(file)
  const fields = parseCarScanText(ocrText)
  return { fields, source: 'ocr', matched: countMatched(fields), text: shorten(ocrText) }
}

/**
 * The odometer is the one field the Scans.ai text layer cannot carry: it is
 * printed inside a photo of the dash, so it only exists in pixels. This reads it
 * with OCR on demand — the form offers it as a separate button precisely because
 * it is the slow path.
 */
export async function readOdometerByOcr(
  file: File,
  onProgress?: (fraction: number) => void,
): Promise<string | undefined> {
  const sources: (HTMLCanvasElement | File)[] = isPdf(file)
    ? await pdfPagesAsCanvas(file, 2)
    : [file]
  for (const source of sources) {
    const fields = parseCarScanText(await ocr(source, onProgress))
    if (fields.odometer) return fields.odometer
  }
  return undefined
}
