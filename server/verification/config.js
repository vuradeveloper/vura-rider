"use strict";

// Ported VERBATIM from ridevura-verification (backend/src/config.js) so the
// checkers keep their tested behaviour. Env names are shared with that project.

const num = (v, d) => (v === undefined || v === "" || Number.isNaN(Number(v)) ? d : Number(v));

const maxUploadMb = num(process.env.MAX_UPLOAD_MB, 10);

module.exports = {
  maxUploadMb,
  maxUploadBytes: maxUploadMb * 1024 * 1024,
  // Police clearance certificates older than this are rejected
  clearanceMaxAgeDays: num(process.env.CLEARANCE_MAX_AGE_DAYS, 90),
  // Vehicle scan / CarScan reports older than this are rejected
  vehicleReportMaxAgeDays: num(process.env.VEHICLE_REPORT_MAX_AGE_DAYS, 90),
  // Face similarity (0-100) below this goes to staff review
  faceMatchThreshold: num(process.env.FACE_MATCH_THRESHOLD, 80),
  // Below this OCR confidence a "pass" is sent to staff review instead
  minOcrConfidence: num(process.env.MIN_OCR_CONFIDENCE, 70),
  minTextChars: 40,
  ocrTimeoutMs: num(process.env.OCR_TIMEOUT_MS, 120000),
  // Document types that may be approved with no human look.
  // Default: none. Everything that passes goes to staff for a final click.
  autoApproveTypes: (process.env.AUTO_APPROVE_TYPES || "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s && s !== "none"),
};
