"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC APP STATUS — the maintenance switch the rider/driver apps poll.
//
// No auth: the app needs to know before sign-in whether Vura is accepting
// rides. The payload deliberately contains ONLY the two booleans + operator
// message + build stamp; no user data, no money, no secrets.
//
//   GET /api/app-status
//   { rider: { maintenance, message }, driver: { maintenance, message },
//     server_build }
// ─────────────────────────────────────────────────────────────────────────────
const express_1 = require("express");
const featureFlags_1 = require("../services/featureFlags");
const offerWorker_1 = require("../services/offerWorker");
const router = (0, express_1.Router)();
router.get("/", async (_req, res) => {
    try {
        const status = await (0, featureFlags_1.readMaintenanceStatus)();
        // Never cache: an operator turning maintenance ON must reach the next
        // launch/foreground immediately.
        res.set("Cache-Control", "no-store, max-age=0");
        res.json({
            rider: {
                maintenance: status.rider.enabled,
                message: status.rider.message,
            },
            driver: {
                maintenance: status.driver.enabled,
                message: status.driver.message,
            },
            server_build: (0, offerWorker_1.getBuildCommit)(),
        });
    }
    catch {
        // Fail OPEN: a status outage must not take the whole platform down.
        res.set("Cache-Control", "no-store, max-age=0");
        res.json({
            rider: { maintenance: false, message: "" },
            driver: { maintenance: false, message: "" },
            server_build: (0, offerWorker_1.getBuildCommit)(),
        });
    }
});
exports.default = router;
//# sourceMappingURL=appStatus.js.map