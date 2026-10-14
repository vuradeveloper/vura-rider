"use strict";

// Ported VERBATIM from ridevura-verification (backend/src/lib/text.js).

function normalize(s) {
  return String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^\S\n]+/g, " ")
    .trim();
}

function squash(s) {
  return normalize(s).replace(/[^A-Z0-9]/g, "");
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Returns the markers that appear in the text (whole-word, tolerant of line breaks). */
function hasAny(text, markers) {
  const n = normalize(text).replace(/\n/g, " ");
  const sq = squash(text);
  return markers.filter((m) => {
    const up = normalize(m);
    const re = new RegExp("(?:^|[^A-Z0-9])" + escapeRe(up).replace(/ /g, "\\s+") + "(?:$|[^A-Z0-9])");
    if (re.test(n)) return true;
    const s = squash(up);
    return s.length >= 8 && sq.includes(s);
  });
}

function utcDate(y, m, d) {
  const dt = new Date(Date.UTC(y, m, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m && dt.getUTCDate() === d ? dt : null;
}

const MONTHS = { JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5, JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11 };

/** Finds dates written as 2027/02/28, 28/02/2027, or 28 FEB 2027. Sorted oldest to newest. */
function findDates(text) {
  const t = normalize(text).replace(/\n/g, " ");
  const found = new Map();
  const add = (d) => d && found.set(d.getTime(), d);

  for (const m of t.matchAll(/(?<!\d)(19\d{2}|20\d{2})\s?[\/\-\.]\s?(\d{1,2})\s?[\/\-\.]\s?(\d{1,2})(?!\d)/g)) {
    add(utcDate(+m[1], +m[2] - 1, +m[3]));
  }
  for (const m of t.matchAll(/(?<!\d)(\d{1,2})\s?[\/\-\.]\s?(\d{1,2})\s?[\/\-\.]\s?(19\d{2}|20\d{2})(?!\d)/g)) {
    add(utcDate(+m[3], +m[2] - 1, +m[1]));
  }
  for (const m of t.matchAll(/(?<!\d)(\d{1,2})\s?(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*\.?,?\s?(19\d{2}|20\d{2})(?!\d)/g)) {
    add(utcDate(+m[3], MONTHS[m[2]], +m[1]));
  }
  return [...found.values()].sort((a, b) => a - b);
}

const iso = (d) => d.toISOString().slice(0, 10);

function todayUtc() {
  const n = new Date();
  return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate()));
}

function levenshtein(a, b) {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return dp[a.length][b.length];
}

/** Share (0-1) of the name's words found in the text, allowing one typo in longer words. null if no name. */
function nameMatchScore(fullName, text) {
  const tokens = normalize(fullName).split(/[^A-Z]+/).filter((t) => t.length >= 3);
  if (!tokens.length) return null;
  const words = normalize(text).split(/[^A-Z]+/).filter((w) => w.length >= 3);
  let hit = 0;
  for (const t of tokens) {
    if (words.some((w) => w === t || (t.length >= 5 && levenshtein(w, t) <= 1))) hit++;
  }
  return hit / tokens.length;
}

module.exports = { normalize, squash, hasAny, findDates, iso, todayUtc, levenshtein, nameMatchScore };
