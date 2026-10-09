// ─────────────────────────────────────────────────────────────────────────────
// OFFER WORKER: boot-log honesty.
// The pre-audit line hardcoded "driver stale 45s" in BOTH src and dist while
// the real numbers were DRIVER_STALE_SECONDS=20 (offline demotion),
// LOCATION_FRESH_SECONDS=20 (candidate freshness) and app_config
// stale_seconds=40 (H3 index eviction) — three DIFFERENT mechanisms the log
// conflated. Pin the line to the compiled constants + the config value + the
// build's git hash, so a boot log can be audited without reading source.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect, afterEach, vi } from "vitest";

// Same harness mocks as the other dispatch-adjacent suites: no live Postgres,
// no firebase-admin/sharp loading just to import the module graph.
vi.mock("../config/database", async () => (await import("./testHarness")).db);
vi.mock("./notify", async () => (await import("./testHarness")).notify);
vi.mock("./vehicleImages", async () => (await import("./testHarness")).vehicleImages);
vi.mock("./config", async () => (await import("./testHarness")).appConfig);

import {
  DRIVER_STALE_SECONDS,
  LOCATION_FRESH_SECONDS,
  OFFER_TTL_SECONDS,
} from "./dispatch";
import { formatBootLog, getBuildCommit } from "./offerWorker";

afterEach(() => {
  delete process.env.BUILD_COMMIT;
});

describe("boot log reports the REAL thresholds", () => {
  it("interpolates the compiled constants, the config value and the hash", () => {
    const line = formatBootLog({ stale_seconds: 40 }, "abc1234");
    expect(line).toBe(
      `[offerWorker] started (2s tick · offer TTL ${OFFER_TTL_SECONDS}s · ` +
        `driver stale ${DRIVER_STALE_SECONDS}s (demote) · ` +
        `loc fresh ${LOCATION_FRESH_SECONDS}s (candidates) · ` +
        `index evict 40s (app_config) · build abc1234)`
    );
    // All three staleness mechanisms visible, distinctly labelled:
    expect(line).toContain(`driver stale ${DRIVER_STALE_SECONDS}s`);
    expect(line).toContain(`loc fresh ${LOCATION_FRESH_SECONDS}s`);
    expect(line).toContain("index evict 40s");
    expect(line).toContain("build abc1234");
  });

  it("marks index evict unknown — never invents a number — when config is unread", () => {
    const line = formatBootLog(null, "abc1234");
    expect(line).toContain("index evict unknown");
    // Compiled constants still print even with no config:
    expect(line).toContain(`driver stale ${DRIVER_STALE_SECONDS}s`);
  });
});

describe("build hash", () => {
  it("prefers the BUILD_COMMIT env override (deployed zip has no .git)", () => {
    process.env.BUILD_COMMIT = "deadbeef";
    expect(getBuildCommit()).toBe("deadbeef");
  });

  it("falls back to git (source checkout) or 'unknown' — never invented", () => {
    delete process.env.BUILD_COMMIT;
    expect(getBuildCommit()).toMatch(/^[0-9a-f]{4,40}$|^unknown$/i);
  });
});
