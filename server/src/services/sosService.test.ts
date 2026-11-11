import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  queryOne: vi.fn(),
  query: vi.fn(async () => [] as any[]),
  execute: vi.fn(async () => ({ rowCount: 1, rows: [] })),
}));
const notify = vi.hoisted(() => ({
  notifySos: vi.fn(async () => ({ contacts_notified: 1, safety_team_notified: true })),
}));

vi.mock("../config/database", () => db);
vi.mock("./safetyConfig", () => ({ ensureSafetyTables: vi.fn(async () => undefined) }));
vi.mock("./locationLog", () => ({ lastRidePoint: vi.fn(async () => null) }));
vi.mock("./safetyNotify", () => notify);

import { triggerSos } from "./sosService";

const RIDE = "11111111-1111-4111-8111-111111111111";
const USER = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

beforeEach(() => {
  db.queryOne.mockReset();
  db.query.mockReset();
  db.query.mockResolvedValue([]);
  db.execute.mockClear();
  notify.notifySos.mockClear();
  notify.notifySos.mockResolvedValue({ contacts_notified: 1, safety_team_notified: true });
});

function mockFirstSos() {
  db.queryOne.mockImplementation(async (sql: string) => {
    if (sql.includes("FROM sos_alerts") && sql.includes("status = 'active'")) return null;
    if (sql.includes("FROM rides r")) {
      return {
        id: RIDE,
        status: "in_progress",
        created_at: "2026-11-11T10:00:00Z",
        trip_started_at: "2026-11-11T10:05:00Z",
        pickup_address: "Sandton",
        destination_address: "Rosebank",
        rider_name: "Thabo Rider",
        rider_phone: "+27821234567",
        driver_name: "Sipho Driver",
        driver_phone: "+27835551234",
        vehicle_make: "Toyota",
        vehicle_model: "Corolla",
        vehicle_color: "White",
        license_plate: "GP 123 GP",
        current_lat: -26.1,
        current_lng: 28.0,
      };
    }
    if (sql.includes("type IN ('share_started', 'share_ended')")) return null;
    if (sql.includes("INSERT INTO sos_alerts")) return { id: "sos-1" };
    return null;
  });
  db.query.mockResolvedValue([
    { name: "Thandi", phone: "+27821112222", email: "thandi@example.com" },
    { name: "No Email", phone: "+27823334444", email: null },
  ]);
}

describe("triggerSos", () => {
  it("records the SOS, includes emergency contacts and emails them", async () => {
    mockFirstSos();
    const result = await triggerSos({
      rideId: RIDE,
      byUserId: USER,
      byRole: "rider",
      location: { lat: -26.1, lng: 28.0 },
    });

    expect(result.id).toBe("sos-1");
    expect(result.duplicate).toBe(false);
    expect(result.share_url).toContain("/share/");
    expect(result.contacts_notified).toBe(1);
    expect(result.safety_team_notified).toBe(true);

    const insert = db.queryOne.mock.calls.find(([sql]) => String(sql).includes("INSERT INTO sos_alerts"));
    const payload = JSON.parse(insert![1][3]);
    expect(payload.emergency_contacts).toEqual([
      { name: "Thandi", phone: "+27821112222", email: "thandi@example.com" },
      { name: "No Email", phone: "+27823334444", email: null },
    ]);
    expect(payload.share_url).toContain("/share/");
    expect(notify.notifySos).toHaveBeenCalledWith(
      expect.objectContaining({
        contacts: expect.any(Array),
        shareUrl: expect.stringContaining("/share/"),
      })
    );
  });

  it("does not create a second alert when SOS is pressed again within two minutes", async () => {
    db.queryOne.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM sos_alerts") && sql.includes("status = 'active'")) {
        return { id: "sos-existing", payload: { ride_id: RIDE } };
      }
      return null;
    });
    const result = await triggerSos({ rideId: RIDE, byUserId: USER, byRole: "rider" });
    expect(result.duplicate).toBe(true);
    expect(result.id).toBe("sos-existing");
    expect(notify.notifySos).not.toHaveBeenCalled();
    expect(
      db.queryOne.mock.calls.some(([sql]) => String(sql).includes("INSERT INTO sos_alerts"))
    ).toBe(false);
  });

  it("still records an SOS outside a trip (panic button) with no share link", async () => {
    db.queryOne.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM sos_alerts")) return null;
      if (sql.includes("INSERT INTO sos_alerts")) return { id: "sos-2" };
      return null;
    });
    db.query.mockResolvedValue([]);
    notify.notifySos.mockResolvedValue({ contacts_notified: 0, safety_team_notified: false });
    const result = await triggerSos({
      byUserId: USER,
      byRole: "driver",
      location: { lat: -26.2, lng: 28.1 },
    });
    expect(result.id).toBe("sos-2");
    expect(result.share_url).toBeNull();
    expect(result.message).toContain("Add an email");
  });
});
