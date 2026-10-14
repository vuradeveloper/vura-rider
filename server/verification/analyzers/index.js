"use strict";

// Ported VERBATIM from ridevura-verification (backend/src/analyzers/index.js).

const id = require("./identity");
const vehicle = require("./vehicle");

const analyzers = {
  id_document: id.analyzeId,
  drivers_license: id.analyzeLicense,
  prdp: id.analyzePrdp,
  criminal_record: id.analyzeCriminalRecord,
  license_disk: vehicle.analyzeLicenseDisk,
  vehicle_scan: vehicle.analyzeVehicleScan,
  carscan_report: vehicle.analyzeCarScan,
};

/** Runs the checks for one document type on its OCR text. Returns { status, reasons, extracted }. */
function analyze(docType, ctx) {
  const fn = analyzers[docType];
  if (!fn) throw new Error(`No analyzer for ${docType}`);
  return fn(ctx);
}

module.exports = { analyze };
