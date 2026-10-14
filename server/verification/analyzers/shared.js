"use strict";

// Ported VERBATIM from ridevura-verification (backend/src/analyzers/shared.js).

const { hasAny, findDates, iso, todayUtc, nameMatchScore } = require("../lib/text");
const { flag } = require("../lib/results");

/** Rejects the document if it doesn't contain enough of the words a real one has. */
function checkMarkers(result, text, markers, min, label) {
  const hits = hasAny(text, markers);
  result.extracted.markersFound = hits.length;
  if (hits.length < min) {
    flag(result, "rejected", `This doesn't look like a ${label}. Upload the correct document.`);
    return false;
  }
  return true;
}

/** Uses the latest date on the document as the expiry date. */
function checkExpiry(result, text, label) {
  const dates = findDates(text);
  if (!dates.length) {
    flag(result, "needs_review", "No dates could be read on this document.");
    return null;
  }
  const latest = dates[dates.length - 1];
  result.extracted.expiry = iso(latest);
  if (latest < todayUtc()) flag(result, "rejected", `This ${label} expired on ${iso(latest)}.`);
  return latest;
}

/** Latest date that is not in the future, used as the issue / report date. */
function checkAge(result, text, label, maxDays) {
  const today = todayUtc();
  const past = findDates(text).filter((d) => d <= new Date(today.getTime() + 86400000));
  if (!past.length) {
    flag(result, "needs_review", `No issue date could be read on this ${label}.`);
    return null;
  }
  const latest = past[past.length - 1];
  const ageDays = Math.floor((today - latest) / 86400000);
  result.extracted.issueDate = iso(latest);
  result.extracted.ageDays = ageDays;
  if (ageDays > maxDays) flag(result, "rejected", `This ${label} is ${ageDays} days old. It must be less than ${maxDays} days old.`);
  return latest;
}

function checkName(result, text, profileName) {
  if (!profileName) return;
  const score = nameMatchScore(profileName, text);
  if (score === null) return;
  result.extracted.nameMatch = Math.round(score * 100) / 100;
  if (score < 0.5) flag(result, "needs_review", "The name on this document doesn't clearly match the name on the account.");
}

module.exports = { checkMarkers, checkExpiry, checkAge, checkName };
