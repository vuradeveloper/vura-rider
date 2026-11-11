import { describe, expect, it } from "vitest";
import { validateDocumentUpload } from "./uploadGuard";

const b64 = (s: string | Buffer) => Buffer.from(s).toString("base64");

describe("document upload guard", () => {
  it("accepts a real JPEG with the right declared type", () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
    const out = validateDocumentUpload(`data:image/jpeg;base64,${b64(jpeg)}`, "image/jpeg");
    expect(out).toEqual({ ok: true, mime: "image/jpeg", sizeBytes: expect.any(Number) });
  });

  it("accepts a real PDF and a generic octet-stream whose bytes are a PDF", () => {
    const pdf = Buffer.from("%PDF-1.4\n% test\n");
    expect(validateDocumentUpload(b64(pdf), "application/pdf").ok).toBe(true);
    expect(validateDocumentUpload(b64(pdf), "application/octet-stream")).toEqual({
      ok: true,
      mime: "application/pdf",
      sizeBytes: expect.any(Number),
    });
  });

  it("rejects HTML disguised as an image", () => {
    const html = Buffer.from("<html><script>alert(1)</script></html>");
    const out = validateDocumentUpload(b64(html), "image/png");
    expect(out).toEqual({ ok: false, status: 415, error: "That file is not a valid image or PDF." });
  });

  it("rejects SVG and executable MIME types outright", () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    expect(validateDocumentUpload(b64(svg), "image/svg+xml").ok).toBe(false);
    expect(validateDocumentUpload(b64(svg), "text/html").ok).toBe(false);
    expect(validateDocumentUpload(b64("MZ..."), "application/x-msdownload").ok).toBe(false);
  });

  it("rejects a declared image type whose bytes are something else", () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
    const out = validateDocumentUpload(b64(png), "image/jpeg");
    expect(out).toEqual({ ok: false, status: 415, error: "File type does not match its contents." });
  });

  it("rejects empty and non-string payloads", () => {
    expect(validateDocumentUpload("", "image/png").ok).toBe(false);
    expect(validateDocumentUpload(null, "image/png").ok).toBe(false);
  });
});
