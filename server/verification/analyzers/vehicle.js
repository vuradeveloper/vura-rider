"use strict";

// Ported VERBATIM from ridevura-verification (backend/src/analyzers/vehicle.js).

const config = require("../config");
const { normalize } = require("../lib/text");
const { newResult, flag } = require("../lib/results");
const { checkMarkers, checkExpiry, checkAge } = require("./shared");

function findVins(text) {
  const matches = normalize(text).replace(/\n/g, " ").match(/\b[A-HJ-NPR-Z0-9]{17}\b/g) || [];
  return [...new Set(matches.filter((v) => /\d/.test(v) && /[A-Z]/.test(v)))];
}

function findPlate(text) {
  const t = normalize(text).replace(/\n/g, " ");
  const labelled = t.match(/(?:LICENCE\s*(?:NO|NUMBER)|VEH(?:ICLE)?\.?\s*REG(?:ISTRATION)?\.?\s*(?:NO|NUMBER)?)\s*[:.]?\s*([A-Z0-9][A-Z0-9 \-]{2,10}[A-Z0-9])/);
  if (labelled) return labelled[1].replace(/[^A-Z0-9]/g, "");
  const modern = t.match(/\b([A-Z]{2}\s?\d{2}\s?[A-Z]{2}\s?(?:GP|WC|ZN|KZN|EC|FS|L|LP|MP|NC|NW))\b/);
  return modern ? modern[1].replace(/[^A-Z0-9]/g, "") : null;
}

function analyzeLicenseDisk({ text }) {
  const r = newResult();
  const ok = checkMarkers(
    r, text,
    ["LICENCE DISC", "LICENSE DISC", "VEHICLE LICENCE", "LICENCE NO", "LICENCE NUMBER", "VIN", "ENGINE NO",
     "ENGINE NUMBER", "DATE OF EXPIRY", "EXPIRY DATE", "GVM", "TARE", "VEHICLE DESCRIPTION", "LISENSIESKYF"],
    2, "vehicle license disk"
  );
  if (!ok) return r;
  const vins = findVins(text);
  r.extracted.vin = vins[0] || null;
  r.extracted.plate = findPlate(text);
  if (!vins.length) flag(r, "needs_review", "The VIN couldn't be read on the license disk.");
  checkExpiry(r, text, "license disk");
  return r;
}

const FLAG_RE = /(STOLEN|WRITTEN[\s-]*OFF|WRITE[\s-]*OFF|HIJACK(?:ED)?|CLONED)\s*[:\-]?\s*(YES|REPORTED|FLAGGED|CONFIRMED)/;

function analyzeVehicleReport(label, markers) {
  return function ({ text }) {
    const r = newResult();
    if (!checkMarkers(r, text, markers, 2, label)) return r;
    r.extracted.vins = findVins(text);
    checkAge(r, text, "report", config.vehicleReportMaxAgeDays);
    if (!r.extracted.vins.length) flag(r, "needs_review", "No VIN could be read on this report.");
    const hit = normalize(text).replace(/\n/g, " ").match(FLAG_RE);
    if (hit) {
      r.extracted.reportFlag = hit[0];
      flag(r, "needs_review", `The report flags the vehicle (${hit[0].toLowerCase()}). Staff must review it.`);
    }
    return r;
  };
}

const analyzeVehicleScan = analyzeVehicleReport("vehicle scan report", [
  "VIN", "VEHICLE", "REGISTRATION", "ENGINE", "INSPECTION", "SCAN", "ROADWORTHY", "ODOMETER", "MILEAGE",
]);

const analyzeCarScan = analyzeVehicleReport("CarScan report", [
  "CARSCAN", "CAR SCAN", "VEHICLE HISTORY", "VIN", "VEHICLE", "STOLEN", "ACCIDENT", "ODOMETER", "MILEAGE", "WRITTEN OFF",
]);

module.exports = { analyzeLicenseDisk, analyzeVehicleScan, analyzeCarScan, findVins };
