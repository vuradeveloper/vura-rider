"use strict";

// Ported VERBATIM from ridevura-verification (backend/src/lib/mrz.js).
// Passport machine readable zone (ICAO 9303, TD3: two lines of 44 characters).

const WEIGHTS = [7, 3, 1];

function charValue(c) {
  if (c === "<") return 0;
  if (c >= "0" && c <= "9") return Number(c);
  if (c >= "A" && c <= "Z") return c.charCodeAt(0) - 55;
  return NaN;
}

function checkDigit(str) {
  let sum = 0;
  for (let i = 0; i < str.length; i++) {
    const v = charValue(str[i]);
    if (Number.isNaN(v)) return NaN;
    sum += v * WEIGHTS[i % 3];
  }
  return sum % 10;
}

function parseYymmdd(s, isBirth) {
  const yy = Number(s.slice(0, 2));
  const mm = Number(s.slice(2, 4));
  const dd = Number(s.slice(4, 6));
  if (!mm || !dd || mm > 12 || dd > 31) return null;
  const currentYY = new Date().getUTCFullYear() % 100;
  const century = isBirth ? (yy > currentYY ? 1900 : 2000) : 2000;
  const dt = new Date(Date.UTC(century + yy, mm - 1, dd));
  return dt.getUTCMonth() === mm - 1 ? dt : null;
}

/** Looks for two consecutive 44-character MRZ lines in OCR text. */
function findMrz(text) {
  const lines = String(text || "")
    .split("\n")
    .map((l) => l.toUpperCase().replace(/\s+/g, "").replace(/«/g, "<"))
    .filter((l) => /^[A-Z0-9<]+$/.test(l) && l.length === 44 && l.includes("<"));
  for (let i = 0; i < lines.length - 1; i++) {
    if (lines[i].startsWith("P")) return [lines[i], lines[i + 1]];
  }
  return null;
}

function validatePassportMRZ(line1, line2) {
  const errors = [];
  const l1 = line1.toUpperCase();
  const l2 = line2.toUpperCase();
  if (l1.length !== 44 || l2.length !== 44) {
    return { errors: ["Each code line must be 44 characters."], expired: false, data: {} };
  }

  const checks = [
    ["passport number", l2.slice(0, 9), l2[9]],
    ["date of birth", l2.slice(13, 19), l2[19]],
    ["expiry date", l2.slice(21, 27), l2[27]],
    ["personal number", l2.slice(28, 42), l2[42]],
    ["overall", l2.slice(0, 10) + l2.slice(13, 20) + l2.slice(21, 43), l2[43]],
  ];
  for (const [label, data, digit] of checks) {
    const emptyPersonal = label === "personal number" && digit === "<" && /^<+$/.test(data);
    if (!emptyPersonal && String(checkDigit(data)) !== digit) errors.push(`The ${label} check digit doesn't match.`);
  }

  const dob = parseYymmdd(l2.slice(13, 19), true);
  const expiry = parseYymmdd(l2.slice(21, 27), false);
  if (!dob) errors.push("The date of birth isn't a valid date.");
  if (!expiry) errors.push("The expiry date isn't a valid date.");

  return {
    errors,
    expired: !!expiry && expiry < new Date(),
    data: {
      number: l2.slice(0, 9).replace(/</g, ""),
      nationality: l2.slice(10, 13).replace(/</g, ""),
      sex: l2[20],
      dateOfBirth: dob ? dob.toISOString().slice(0, 10) : null,
      expiryDate: expiry ? expiry.toISOString().slice(0, 10) : null,
    },
  };
}

module.exports = { findMrz, validatePassportMRZ, checkDigit };
