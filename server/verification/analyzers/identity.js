"use strict";

// Ported VERBATIM from ridevura-verification (backend/src/analyzers/identity.js).

const config = require("../config");
const { hasAny } = require("../lib/text");
const { findSaIds, parseSaId } = require("../lib/saId");
const { findMrz, validatePassportMRZ } = require("../lib/mrz");
const { newResult, flag } = require("../lib/results");
const { checkMarkers, checkExpiry, checkName } = require("./shared");

const ID_MARKERS = [
  "IDENTITY NUMBER", "IDENTITY CARD", "IDENTITY DOCUMENT", "IDENTITEITSNOMMER",
  "ID NUMBER", "REPUBLIC OF SOUTH AFRICA", "SOUTH AFRICA", "SUID-AFRIKA", "HOME AFFAIRS", "SURNAME",
];

function analyzeId({ text, profileName }) {
  const r = newResult();

  // Foreign drivers may upload a passport instead of a South African ID.
  const mrz = findMrz(text);
  if (mrz) {
    const v = validatePassportMRZ(mrz[0], mrz[1]);
    r.extracted.documentKind = "passport";
    r.extracted.passport = v.data;
    if (v.errors.length) {
      flag(r, "needs_review", `The code at the bottom of the passport didn't pass its checks. ${v.errors.join(" ")}`);
    }
    if (v.expired) flag(r, "rejected", "This passport has expired.");
    checkName(r, text, profileName);
    return r;
  }

  r.extracted.documentKind = "sa_id";
  const ids = findSaIds(text);
  r.extracted.idNumbers = ids.valid;
  const markers = hasAny(text, ID_MARKERS);
  r.extracted.markersFound = markers.length;

  if (!ids.valid.length) {
    if (markers.length) {
      flag(r, "rejected", "We couldn't read a valid ID number. Upload a clear, uncropped photo or scan with no glare.");
    } else {
      flag(r, "rejected", "This doesn't look like an ID Document. Upload the correct document.");
    }
    return r;
  }

  r.extracted.idNumber = ids.valid[0];
  const info = parseSaId(ids.valid[0]);
  r.extracted.dateOfBirth = info.dateOfBirth;
  r.extracted.gender = info.gender;
  r.extracted.citizen = info.citizen;
  if (!markers.length) flag(r, "needs_review", "A valid ID number was found but the document type isn't clear.");
  checkName(r, text, profileName);
  return r;
}

function analyzeLicense({ text, profileName }) {
  const r = newResult();
  const ok = checkMarkers(
    r, text,
    ["DRIVING LICENCE", "DRIVING LICENSE", "DRIVER'S LICENCE", "DRIVERS LICENCE", "DRIVER'S LICENSE", "RIJBEWYS"],
    1, "Driver's License"
  );
  if (!ok) return r;
  r.extracted.idNumbers = findSaIds(text).valid;
  checkExpiry(r, text, "driver's license");
  checkName(r, text, profileName);
  return r;
}

function analyzePrdp({ text, profileName }) {
  const r = newResult();
  const ok = checkMarkers(
    r, text,
    ["PROFESSIONAL DRIVING PERMIT", "PRDP", "PROFESSIONELE BESTUURSPERMIT", "PROFESSIONAL DRIVER'S PERMIT"],
    1, "PrDP (Professional Driving Permit)"
  );
  if (!ok) return r;
  r.extracted.idNumbers = findSaIds(text).valid;
  checkExpiry(r, text, "PrDP");
  if (!hasAny(text, ["PASSENGER", "PASSENGERS", "PASSASIERS"]).length) {
    flag(r, "needs_review", "We couldn't confirm that this permit covers passengers (category P).");
  }
  checkName(r, text, profileName);
  return r;
}

function analyzeCriminalRecord({ text, profileName }) {
  const r = newResult();
  const ok = checkMarkers(
    r, text,
    ["POLICE CLEARANCE", "SOUTH AFRICAN POLICE SERVICE", "CRIMINAL RECORD CENTRE", "CRIMINAL RECORD CENTER", "SAPS", "CRIMINAL RECORD"],
    1, "police clearance certificate"
  );
  if (!ok) return r;
  r.extracted.idNumbers = findSaIds(text).valid;
  checkAge(r, text, "clearance certificate", config.clearanceMaxAgeDays);

  const noRecord = /NO\s+(PREVIOUS\s+)?(CRIMINAL\s+RECORD|CONVICTIONS?)/i.test(text.replace(/\s+/g, " "));
  r.extracted.statesNoRecord = noRecord;
  if (!noRecord) {
    flag(r, "needs_review", "No 'no criminal record' statement was found. Staff must read this certificate.");
  }
  checkName(r, text, profileName);
  return r;
}

module.exports = { analyzeId, analyzeLicense, analyzePrdp, analyzeCriminalRecord };
