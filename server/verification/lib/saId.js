"use strict";

// Ported VERBATIM from ridevura-verification (backend/src/lib/saId.js).

function luhnValid(digits) {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

function validDate(y, m, d) {
  const dt = new Date(Date.UTC(y, m, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m && dt.getUTCDate() === d ? dt : null;
}

/** Validates a South African 13-digit ID number (date, citizenship digit, Luhn check digit). */
function parseSaId(id) {
  if (!/^\d{13}$/.test(id)) return { valid: false, reason: "must be 13 digits" };
  const yy = Number(id.slice(0, 2));
  const mm = Number(id.slice(2, 4));
  const dd = Number(id.slice(4, 6));
  const currentYY = new Date().getUTCFullYear() % 100;
  const first = yy > currentYY ? 1900 : 2000;
  const dob = validDate(first + yy, mm - 1, dd) || validDate((first === 1900 ? 2000 : 1900) + yy, mm - 1, dd);
  if (!dob || dob > new Date()) return { valid: false, reason: "invalid date of birth" };
  if (id[10] !== "0" && id[10] !== "1") return { valid: false, reason: "invalid citizenship digit" };
  if (!luhnValid(id)) return { valid: false, reason: "check digit does not match" };
  return {
    valid: true,
    dateOfBirth: dob.toISOString().slice(0, 10),
    gender: Number(id.slice(6, 10)) >= 5000 ? "male" : "female",
    citizen: id[10] === "0",
  };
}

/** Finds 13-digit numbers in OCR text (with or without spaces) and returns those that are valid SA IDs. */
function findSaIds(text) {
  const t = String(text || "").replace(/\n/g, " ");
  const candidates = new Set();
  for (const m of t.matchAll(/(?<!\d)\d{6}\s?\d{4}\s?\d{3}(?!\d)/g)) candidates.add(m[0].replace(/\s/g, ""));
  const all = [...candidates];
  return { candidates: all, valid: all.filter((c) => parseSaId(c).valid) };
}

module.exports = { parseSaId, findSaIds, luhnValid };
