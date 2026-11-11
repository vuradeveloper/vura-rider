/**
 * Upload boundary for driver/rider documents. Kept dependency-free so the
 * allow-list and magic-byte check can be unit-tested without booting Express,
 * S3 or Postgres.
 */

export const DOC_MAX_BYTES = 12 * 1024 * 1024;

export const DOC_MIME_ALLOWED = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  "application/pdf",
  "application/octet-stream",
]);

export type DocumentCheck =
  | { ok: true; mime: string; sizeBytes: number }
  | { ok: false; status: 400 | 413 | 415; error: string };

export function cleanMime(value: unknown): string {
  return String(value || "").toLowerCase().split(";")[0].trim();
}

export function base64Payload(data: string): string {
  const comma = data.indexOf(",");
  return data.startsWith("data:") && comma !== -1 ? data.slice(comma + 1) : data;
}

export function sniffDocumentMime(base64: string): string | null {
  let buf: Buffer;
  try {
    buf = Buffer.from(base64.slice(0, 64), "base64");
  } catch {
    return null;
  }
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (
    buf.length >= 8 &&
    buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return "image/png";
  }
  if (buf.length >= 12 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") {
    return "image/webp";
  }
  if (buf.length >= 4 && buf.toString("ascii", 0, 4) === "%PDF") return "application/pdf";
  if (buf.length >= 12 && buf.toString("ascii", 4, 8) === "ftyp") {
    const brand = buf.toString("ascii", 8, 12);
    if (["heic", "heix", "hevc", "hevx", "mif1", "msf1"].includes(brand)) return "image/heic";
  }
  return null;
}

export function validateDocumentUpload(data: unknown, declaredMime: unknown): DocumentCheck {
  if (typeof data !== "string" || data.length === 0) {
    return { ok: false, status: 400, error: "Document data (base64) is required" };
  }
  const declared = cleanMime(declaredMime) || "application/octet-stream";
  if (!DOC_MIME_ALLOWED.has(declared)) {
    return {
      ok: false,
      status: 415,
      error: "Unsupported file type. Upload a JPEG, PNG, WebP, HEIC or PDF.",
    };
  }
  const payload = base64Payload(data);
  const sizeBytes = Math.floor((payload.length * 3) / 4);
  if (sizeBytes > DOC_MAX_BYTES) {
    return { ok: false, status: 413, error: "File too large. Maximum 12 MB." };
  }
  const actual = sniffDocumentMime(payload);
  if (!actual) {
    return { ok: false, status: 415, error: "That file is not a valid image or PDF." };
  }
  if (declared !== "application/octet-stream" && declared !== actual) {
    return { ok: false, status: 415, error: "File type does not match its contents." };
  }
  return { ok: true, mime: actual, sizeBytes };
}
