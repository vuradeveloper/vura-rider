"use strict";

// Ported VERBATIM from ridevura-verification (backend/src/docTypes.js).
const DOC_TYPES = {
  id_document: { label: "ID Document", required: true },
  drivers_license: { label: "Driver's License", required: true },
  prdp: { label: "PRDP", required: true },
  criminal_record: { label: "Criminal Record", required: true },
  license_disk: { label: "License Disk", required: true },
  vehicle_scan: { label: "Vehicle Scan", required: true },
  carscan_report: { label: "CarScan Report", required: true },
  selfie: { label: "Selfie", required: false },
};

module.exports = { DOC_TYPES };
