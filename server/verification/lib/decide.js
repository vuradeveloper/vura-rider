"use strict";

// Ported VERBATIM from ridevura-verification (backend/src/lib/decide.js).
// Pure decision logic: no AWS or Firebase calls, so it is easy to test.

const config = require("../config");
const { DOC_TYPES } = require("../docTypes");
const { worst } = require("./results");

const processed = (d) => d && d.autoStatus != null;

/** Compares documents against each other. Returns { docType: [{ status, msg }] }. */
function computeIssues(docs, face) {
  const issues = {};
  const add = (type, status, msg) => (issues[type] = issues[type] || []).push({ status, msg });

  // 1. Same person: ID number on every personal document must match the ID Document
  const idDoc = docs.id_document;
  const refId = processed(idDoc) ? idDoc.extracted?.idNumber : null;
  const idIsPassport = processed(idDoc) && idDoc.extracted?.documentKind === "passport";

  for (const type of ["drivers_license", "prdp", "criminal_record"]) {
    const d = docs[type];
    if (!processed(d) || d.autoStatus === "rejected") continue;
    const found = d.extracted?.idNumbers || [];
    if (!processed(idDoc)) add(type, "needs_review", "Waiting for the ID Document so ID numbers can be compared.");
    else if (idIsPassport) add(type, "needs_review", "The ID Document is a passport. Staff must confirm this document is for the same person.");
    else if (!refId) add(type, "needs_review", "The ID number couldn't be read from the ID Document, so numbers can't be compared.");
    else if (!found.length) add(type, "needs_review", "No ID number could be read on this document.");
    else if (!found.includes(refId)) add(type, "rejected", "The ID number on this document doesn't match the ID Document.");
  }

  // 2. Same vehicle: VIN on the reports must match the License Disk
  const disk = docs.license_disk;
  const diskVin = processed(disk) ? disk.extracted?.vin : null;
  for (const type of ["vehicle_scan", "carscan_report"]) {
    const d = docs[type];
    if (!processed(d) || d.autoStatus === "rejected") continue;
    const vins = d.extracted?.vins || [];
    if (!processed(disk)) add(type, "needs_review", "Waiting for the License Disk so vehicle details can be compared.");
    else if (!diskVin) add(type, "needs_review", "The VIN couldn't be read from the License Disk, so it can't be compared.");
    else if (vins.length && !vins.includes(diskVin)) add(type, "needs_review", "The VIN on this report doesn't match the License Disk.");
  }

  // 3. Face on the ID vs selfie / licence photo
  if (face && face.targetType && docs[face.targetType]) {
    if (face.noFace) add(face.targetType, "needs_review", "We couldn't find a clear face to compare with the ID Document.");
    else if (face.similarity < config.faceMatchThreshold) {
      add(face.targetType, "needs_review", `The face doesn't clearly match the ID Document (${face.similarity}% similarity).`);
    }
  }
  return issues;
}

const canAutoApprove = (type) => type !== "criminal_record" && config.autoApproveTypes.includes(type);

/** Combines the automatic result with cross-document issues into the final status. */
function finalize(type, doc, issues = []) {
  let status = doc.autoStatus;
  const reasons = [...(doc.autoReasons || [])];
  for (const i of issues) {
    status = worst(status, i.status);
    reasons.push(i.msg);
  }
  if (status === "approved" && !canAutoApprove(type)) {
    status = "needs_review";
    reasons.push("Automatic checks passed. Waiting for staff approval.");
  }
  return { status, reasons };
}

/** Overall driver verification state. */
function summarize(docs) {
  const required = Object.keys(DOC_TYPES).filter((k) => DOC_TYPES[k].required);
  const done = (k) => docs[k] && docs[k].status !== "uploading";
  const missing = required.filter((k) => !done(k));
  const rejected = required.filter((k) => docs[k]?.status === "rejected");
  const inReview = required.filter((k) => ["needs_review", "processing"].includes(docs[k]?.status));
  let status = "approved";
  if (missing.length) status = "incomplete";
  else if (rejected.length) status = "action_required";
  else if (inReview.length) status = "in_review";
  return { status, missing, rejected, inReview };
}

module.exports = { computeIssues, finalize, summarize, canAutoApprove };
