import type { Server as SocketIOServer } from "socket.io";
import type { AppConfig } from "./config";
/**
 * Drop drivers from the H3 index who have gone quiet past stale_seconds
 * (40 today; read from app_config, never hardcoded here).
 *
 * Cheap by construction: idx_driver_cells_fresh (last_seen_at) turns the
 * DELETE into an index range scan — no seq scan, no lock on driver_profiles,
 * and driver_cells rows are rebuildable from the next GPS ping, so a lost row
 * costs nothing.
 */
export declare function evictStaleIndexOnce(): Promise<number>;
/**
 * Short hash of the running build, so a boot log line can be matched to the
 * commit (and therefore the server/dist rebuild) that produced it. Order:
 *   1. BUILD_COMMIT env — the only source that works when the deployed
 *      artifact is a zip without a .git directory (Elastic Beanstalk);
 *   2. `git rev-parse` — dev machines and source checkouts;
 *   3. "unknown" — never invent a hash.
 */
export declare function getBuildCommit(): string;
/**
 * The boot line. It used to hardcode "driver stale 45s", which was wrong in
 * two different ways: the compiled demotion threshold is DRIVER_STALE_SECONDS
 * (20 in src; whatever the deployed dist was built with), and H3 index
 * eviction is a THIRD, separate value (app_config stale_seconds, 40 today).
 * Print every real number plus the build hash so an audit can verify a running
 * server without reading source.
 *
 * Pure on purpose — unit-tested in offerWorker.boot.test.ts.
 */
export declare function formatBootLog(cfg: Pick<AppConfig, "stale_seconds"> | null, buildCommit: string): string;
export declare function startOfferWorker(io: SocketIOServer): void;
export declare function stopOfferWorker(): void;
//# sourceMappingURL=offerWorker.d.ts.map