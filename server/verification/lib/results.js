"use strict";

// Ported VERBATIM from ridevura-verification (backend/src/lib/results.js).

const ORDER = { approved: 0, needs_review: 1, rejected: 2 };
const worst = (a, b) => (ORDER[a] >= ORDER[b] ? a : b);

const newResult = () => ({ status: "approved", reasons: [], extracted: {} });

function flag(result, status, message) {
  result.status = worst(result.status, status);
  result.reasons.push(message);
}

module.exports = { ORDER, worst, newResult, flag };
