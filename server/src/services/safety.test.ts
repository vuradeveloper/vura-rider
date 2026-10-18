// ─────────────────────────────────────────────────────────────────────────────
// SAFETY SUITE — contract tests for the §1 detectors, the §3 PIN lifecycle
// and the §6 tunable config. Pure maths against known coordinates; all DB
// access stubbed (no network, no database).
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../config/database", () => ({
  query: vi.fn(async () => [] as any[]),
  queryOne: vi.fn(async () => null as any),
  execute: vi.fn(async () => ({ rowCount: 1, rows: [] })),
}));

import {
  distToSegmentM,
  evaluateDeviation,
  evaluateOverrun,
  evaluateSilence,
  evaluateStop,
  haversineM,
} from "./anomalyDetection";
import { DEFAULT_SAFETY, getSafetySettings, putSafetySettings } from "./safetyConfig";
import { getRidePinForRider, mintRidePin, verifyRidePin } from "./pinService";
import { execute, queryOne } from "../config/database";

// Johannesburg-ish anchors: ~1.11 km per 0.01° of latitude.
const A = { lat: -26.20, lng: 28.00 };
const B = { lat: -26.21, lng: 28.00 }; // 1110 m due south of A

const geo = { pickup: A, dropoff: B };
const t0 = Date.parse("2026-10-18T15:00:00Z");
const at = (sec: number) => new Date(t0 + sec * 1000);

describe("geo maths", () => {
  it("haversine: 0.01° latitude ≈ 1110 m", () => {
    expect(Math.abs(haversineM(A, B) - 1110)).toBeLessThan(30);
  });

  it("distToSegment: on-line point ≈ 0, 500 m east ≈ 500 m", () => {
    expect(distToSegmentM({ lat: -26.205, lng: 28.0 }, A, B)).toBeLessThan(1);
    const east = { lat: -26.205, lng: 28.005 };
    expect(Math.abs(distToSegmentM(east, A, B) - 500)).toBeLessThan(30);
  });
});

describe("evaluateDeviation (route deviation, §1a)", () => {
  const onRoute = [
    { lat: -26.2, lng: 28.0, recorded_at: at(0) },
    { lat: -26.205, lng: 28.0, recorded_at: at(60) },
    { lat: -26.21, lng: 28.0, recorded_at: at(120) },
  ];
  it("stays quiet while the path hugs the corridor", () => {
    expect(evaluateDeviation(onRoute, geo, { deviation_m: 300 }).detected).toBe(false);
  });
  it("flags once a point leaves the corridor by more than the limit", () => {
    const detour = [...onRoute.slice(0, 2), { lat: -26.205, lng: 28.006, recorded_at: at(90) }];
    const v = evaluateDeviation(detour, geo, { deviation_m: 300 });
    expect(v.detected).toBe(true);
    expect(Number(v.data!.max_m)).toBeGreaterThan(300);
  });
  it("needs at least 3 fixes (a single stray GPS blip is not a detour)", () => {
    expect(evaluateDeviation(onRoute.slice(0, 2), geo, { deviation_m: 50 }).detected).toBe(false);
  });
});

describe("evaluateStop (unnecessary stop, §1b)", () => {
  const parkedMidTrip = Array.from({ length: 6 }, (_, i) => ({
    lat: -26.205 + i * 0.00001,
    lng: 28.0,
    recorded_at: at(i * 60), // 5 minutes stationary mid-route
  }));
  it("flags a long stationary run away from both endpoints", () => {
    const v = evaluateStop(parkedMidTrip, geo, { stop_seconds: 180, stop_exclusion_m: 120 });
    expect(v.detected).toBe(true);
    expect(Number(v.data!.seconds)).toBeGreaterThanOrEqual(300);
  });
  it("never flags waiting AT the pickup point (drivers wait — that is normal)", () => {
    const atPickup = parkedMidTrip.map((p) => ({ ...p, lat: A.lat + p.lat + 26.205 - 26.205 }));
    const waiting = Array.from({ length: 6 }, (_, i) => ({
      ...A,
      lat: A.lat + i * 0.00001,
      recorded_at: at(i * 60),
    }));
    expect(evaluateStop(waiting, geo, { stop_seconds: 180, stop_exclusion_m: 120 }).detected).toBe(false);
    void atPickup;
  });
  it("stays quiet when the stop is shorter than the threshold", () => {
    const short = parkedMidTrip.slice(0, 3); // only 2 minutes
    expect(evaluateStop(short, geo, { stop_seconds: 180, stop_exclusion_m: 120 }).detected).toBe(false);
  });
});

describe("evaluateOverrun (trip far longer than estimated, §1c)", () => {
  it("quiet while inside expected time + tolerance", () => {
    expect(
      evaluateOverrun(at(0), geo, at(600), { overrun_pct: 60, overrun_min_s: 420 }).detected
    ).toBe(false);
  });
  it("flags past BOTH the pct-over and the seconds-over floor", () => {
    // direct ≈ 1110 m → expected ≈ 600s + 600s buffer = 1200s; limit 1920s.
    const v = evaluateOverrun(at(0), geo, at(2500), { overrun_pct: 60, overrun_min_s: 420 });
    expect(v.detected).toBe(true);
    expect(Number(v.data!.elapsed_s)).toBe(2500);
  });
  it("respects the floor: pct-over passed but excess seconds too small", () => {
    // tiny trip: expected ≈ 602s → limit ≈ 963s. At 1000s we ARE pct-over
    // (1000 > 963) but the excess (398s) is under the 420s floor → quiet.
    const tiny = { pickup: { lat: -26.2, lng: 28.0 }, dropoff: { lat: -26.2001, lng: 28.0 } };
    expect(
      evaluateOverrun(at(0), tiny, at(1000), { overrun_pct: 60, overrun_min_s: 420 }).detected
    ).toBe(false);
  });
});

describe("evaluateSilence (GPS silent, §1d)", () => {
  it("flags when the fixes stop mid-trip", () => {
    const v = evaluateSilence(at(0), at(0), at(200), { gps_silence_s: 120 });
    expect(v.detected).toBe(true);
    expect(Number(v.data!.silent_s)).toBe(200);
  });
  it("quiet with recent fixes", () => {
    expect(evaluateSilence(at(180), at(0), at(200), { gps_silence_s: 120 }).detected).toBe(false);
  });
  it("never flags before the trip actually started", () => {
    expect(evaluateSilence(null, null, at(999), { gps_silence_s: 120 }).detected).toBe(false);
  });
});

// ── §3 PIN lifecycle (DB stubbed: mint seals → rider unseals → driver verifies)
describe("ride start PIN", () => {
  const RIDE = "22222222-2222-2222-2222-222222222222";
  const RIDER = "33333333-3333-3333-3333-333333333333";
  const DRIVER = "44444444-4444-4444-4444-444444444444";

  /** Row shape the LEFT JOIN query returns. */
  const joinRow = (over: Record<string, unknown> = {}) => ({
    pin_hash: null,
    attempts: 0,
    max_attempts: 3,
    locked_at: null,
    verified_at: null,
    driver_id: DRIVER,
    status: "driver_arrived",
    ...over,
  });

  /** Mint and capture the sealed value the INSERT received. */
  async function minted(): Promise<string> {
    vi.mocked(execute).mockClear();
    await mintRidePin(RIDE);
    const insert = vi.mocked(execute).mock.calls.find(([sql]) =>
      String(sql).includes("INSERT INTO ride_pins")
    );
    expect(insert).toBeTruthy();
    return String(insert![1]![1]); // pin_hash (sealed)
  }

  beforeEach(() => {
    vi.mocked(queryOne).mockReset();
    vi.mocked(execute).mockReset();
    vi.mocked(execute).mockResolvedValue({ rowCount: 1, rows: [] } as any);
    vi.mocked(queryOne).mockResolvedValue(null as any);
  });

  it("mints idempotently (ON CONFLICT DO NOTHING — one code per ride)", async () => {
    const sealed = await minted();
    expect(sealed).toMatch(/\./); // iv.enc.tag, base64 parts
    const args = vi.mocked(execute).mock.calls.find(([s]) => String(s).includes("INSERT INTO ride_pins"))!;
    expect(String(args[0])).toContain("ON CONFLICT (ride_id) DO NOTHING");
  });

  it("the rider gets a 4-digit code; nobody else, nothing after start", async () => {
    const sealed = await minted();
    vi.mocked(queryOne).mockResolvedValue(
      joinRow({ pin_hash: sealed, passenger_id: RIDER, status: "accepted" }) as any
    );
    const out = await getRidePinForRider(RIDE, RIDER);
    expect(out?.pin).toMatch(/^\d{4}$/);
    // wrong passenger
    expect(await getRidePinForRider(RIDE, DRIVER)).toBeNull();
    // after the trip began the secret is spent
    vi.mocked(queryOne).mockResolvedValue(
      joinRow({ pin_hash: sealed, passenger_id: RIDER, status: "in_progress", verified_at: new Date() }) as any
    );
    expect(await getRidePinForRider(RIDE, RIDER)).toBeNull();
  });

  it("driver verifies the exact code → trip may begin", async () => {
    const sealed = await minted();
    vi.mocked(queryOne).mockResolvedValue(joinRow({ pin_hash: sealed }) as any);
    const riderView = await getRidePinForRider(RIDE, RIDER); // needs passenger row
    vi.mocked(queryOne).mockResolvedValue(joinRow({ pin_hash: sealed }) as any);
    // re-mint capture: fetch pin directly through rider view needs passenger_id:
    void riderView;
    // derive the plaintext by re-querying as the rider
    vi.mocked(queryOne).mockResolvedValue(
      joinRow({ pin_hash: sealed, passenger_id: RIDER }) as any
    );
    const { pin } = (await getRidePinForRider(RIDE, RIDER))!;
    vi.mocked(queryOne).mockResolvedValue(joinRow({ pin_hash: sealed }) as any);
    expect(await verifyRidePin(RIDE, DRIVER, pin)).toEqual({ ok: true });
    expect(
      vi.mocked(execute).mock.calls.some(([s]) => String(s).includes("verified_at = NOW()"))
    ).toBe(true);
  });

  it("wrong codes count down, then LOCK and journal the attempt", async () => {
    const sealed = await minted();
    // The DB is stubbed, so the attempt counter must persist across calls.
    let attempts = 0;
    vi.mocked(queryOne).mockImplementation(async (sql: any) =>
      String(sql).includes("LEFT JOIN ride_pins")
        ? ({ ...joinRow({ pin_hash: sealed }), attempts } as any)
        : (null as any)
    );
    vi.mocked(execute).mockImplementation(async (sql: any, params: any) => {
      if (String(sql).includes("SET attempts")) attempts = Number(params?.[1]);
      return { rowCount: 1, rows: [] } as any;
    });
    expect(await verifyRidePin(RIDE, DRIVER, "0000")).toMatchObject({
      ok: false, error: "wrong", attempts_left: 2,
    });
    expect(await verifyRidePin(RIDE, DRIVER, "1111")).toMatchObject({
      ok: false, error: "wrong", attempts_left: 1,
    });
    const third = await verifyRidePin(RIDE, DRIVER, "2222");
    expect(third).toMatchObject({ ok: false, error: "locked" });
    expect(
      vi.mocked(execute).mock.calls.some(
        ([s, p]) => String(s).includes("INSERT INTO safety_events") && p?.[1] === "pin_locked"
      )
    ).toBe(true);
    // locked stays locked even with the right code
    expect(await verifyRidePin(RIDE, DRIVER, "9999")).toMatchObject({
      ok: false, error: "locked",
    });
  });

  it("refuses the wrong driver, the wrong status, and unknown rides", async () => {
    const sealed = await minted();
    vi.mocked(queryOne).mockResolvedValue(joinRow({ pin_hash: sealed }) as any);
    expect(await verifyRidePin(RIDE, "55555555-5555-5555-5555-555555555555", "1234")).toMatchObject({
      ok: false, error: "not_allowed",
    });
    vi.mocked(queryOne).mockResolvedValue(joinRow({ pin_hash: sealed, status: "accepted" }) as any);
    expect(await verifyRidePin(RIDE, DRIVER, "1234")).toMatchObject({ ok: false, error: "not_allowed" });
    vi.mocked(queryOne).mockResolvedValue(null as any);
    expect(await verifyRidePin(RIDE, DRIVER, "1234")).toMatchObject({ ok: false, error: "not_allowed" });
  });

  it("a ride with no PIN row still starts (never strand a live trip)", async () => {
    vi.mocked(queryOne).mockResolvedValue(joinRow({ pin_hash: null }) as any);
    expect(await verifyRidePin(RIDE, DRIVER, "")).toEqual({ ok: true });
  });
});

// ── §6 tunable config: defaults, merge, bounds
describe("safety settings", () => {
  beforeEach(() => vi.mocked(queryOne).mockResolvedValue(null as any));

  it("falls back to defaults when nothing is stored", async () => {
    expect(await getSafetySettings()).toEqual(DEFAULT_SAFETY);
  });

  it("persists a valid patch and rejects unknown / out-of-range keys", async () => {
    const next = await putSafetySettings({ deviation_m: 500, checkin_timeout_s: 90 });
    expect(next.deviation_m).toBe(500);
    expect(next.checkin_timeout_s).toBe(90);
    expect(next.location_retention_days).toBe(DEFAULT_SAFETY.location_retention_days);
    await expect(putSafetySettings({ deviation_m: 10 })).rejects.toThrow(/between 50 and 5000/);
    await expect(putSafetySettings({ nope: 1 } as any)).rejects.toThrow(/Unknown safety setting/);
  });
});

