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
import { Router, type Request, type Response } from "express";
import { readMaintenanceStatus } from "../services/featureFlags";
import { getBuildCommit } from "../services/offerWorker";

const router = Router();

router.get("/", async (_req: Request, res: Response) => {
  try {
    const status = await readMaintenanceStatus();
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
      server_build: getBuildCommit(),
    });
  } catch {
    // Fail OPEN: a status outage must not take the whole platform down.
    res.set("Cache-Control", "no-store, max-age=0");
    res.json({
      rider: { maintenance: false, message: "" },
      driver: { maintenance: false, message: "" },
      server_build: getBuildCommit(),
    });
  }
});

export default router;
