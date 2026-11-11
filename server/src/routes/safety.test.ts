import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";

const db = vi.hoisted(() => ({
  query: vi.fn(async () => [] as any[]),
  queryOne: vi.fn(),
  execute: vi.fn(async () => ({ rowCount: 1, rows: [] })),
}));
const sos = vi.hoisted(() => ({
  ensureShareToken: vi.fn(async () => "token-1"),
  publicBaseUrl: vi.fn(() => "https://api.ridevura.com"),
  triggerSos: vi.fn(async () => ({
    id: "sos-1",
    ride_id: "11111111-1111-4111-8111-111111111111",
    message: "Help alerted",
    share_url: "https://api.ridevura.com/share/token-1",
    contacts_notified: 1,
    safety_team_notified: true,
    duplicate: false,
  })),
}));

vi.mock("../config/database", () => db);
vi.mock("../middleware/auth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.userId = "firebase-1";
    next();
  },
}));
vi.mock("../services/sosService", () => sos);
vi.mock("../services/checkinService", () => ({ respondCheckin: vi.fn() }));
vi.mock("../services/pinService", () => ({ getRidePinForRider: vi.fn() }));
vi.mock("../services/safetyConfig", () => ({ ensureSafetyTables: vi.fn(async () => undefined) }));

import safetyRouter from "./safety";

const RIDE = "11111111-1111-4111-8111-111111111111";
const USER = "user-1";
let server: any;
let base = "";

beforeEach(async () => {
  db.query.mockReset();
  db.query.mockResolvedValue([]);
  db.queryOne.mockReset();
  db.execute.mockClear();

  const app = express();
  app.use(express.json());
  app.use("/api/safety", safetyRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  base = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
});

afterEach(() => server?.close());

const headers = { Authorization: "Bearer t", "Content-Type": "application/json" };

function userQuery() {
  return { id: USER };
}

describe("emergency contacts", () => {
  it("caps an account at five contacts", async () => {
    db.queryOne.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM users")) return userQuery();
      if (sql.includes("COUNT(*)::int")) return { n: 5 };
      return null;
    });
    const res = await fetch(`${base}/api/safety/contacts`, {
      method: "POST",
      headers,
      body: JSON.stringify({ name: "Thandi", phone: "+27821112222" }),
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "contact_limit" });
  });

  it("rejects a duplicate phone number", async () => {
    db.queryOne.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM users")) return userQuery();
      if (sql.includes("COUNT(*)::int")) return { n: 1 };
      if (sql.includes("regexp_replace(phone")) return { id: "existing" };
      return null;
    });
    const res = await fetch(`${base}/api/safety/contacts`, {
      method: "POST",
      headers,
      body: JSON.stringify({ name: "Thandi", phone: "+27 82 111 2222" }),
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "duplicate_contact" });
  });

  it("saves a contact with an email for SOS alerts", async () => {
    db.queryOne.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM users")) return userQuery();
      if (sql.includes("COUNT(*)::int")) return { n: 0 };
      if (sql.includes("regexp_replace(phone")) return null;
      if (sql.includes("INSERT INTO emergency_contacts")) {
        return {
          id: "c-1",
          name: "Thandi",
          phone: "+27821112222",
          email: "thandi@example.com",
          relationship: "Sister",
        };
      }
      return null;
    });
    const res = await fetch(`${base}/api/safety/contacts`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        name: "Thandi",
        phone: "+27821112222",
        email: "thandi@example.com",
        relationship: "Sister",
      }),
    });
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ email: "thandi@example.com" });
  });
});

describe("safety ownership", () => {
  it("refuses to SOS on someone else's ride", async () => {
    db.queryOne.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM users")) return userQuery();
      if (sql.includes("FROM rides WHERE id")) {
        return { passenger_id: "other-user", driver_id: null };
      }
      return null;
    });
    const res = await fetch(`${base}/api/safety/sos`, {
      method: "POST",
      headers,
      body: JSON.stringify({ rideId: RIDE }),
    });
    expect(res.status).toBe(403);
    expect(sos.triggerSos).not.toHaveBeenCalled();
  });

  it("refuses to share someone else's ride", async () => {
    db.queryOne.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM users")) return userQuery();
      if (sql.includes("FROM rides WHERE id")) {
        return { passenger_id: "other-user", driver_id: "another-driver" };
      }
      return null;
    });
    const res = await fetch(`${base}/api/safety/share`, {
      method: "POST",
      headers,
      body: JSON.stringify({ rideId: RIDE }),
    });
    expect(res.status).toBe(403);
    expect(sos.ensureShareToken).not.toHaveBeenCalled();
  });

  it("lets a party SOS and returns the share/contact truth", async () => {
    db.queryOne.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM users")) return userQuery();
      if (sql.includes("FROM rides WHERE id")) {
        return { passenger_id: USER, driver_id: null };
      }
      return null;
    });
    const res = await fetch(`${base}/api/safety/sos`, {
      method: "POST",
      headers,
      body: JSON.stringify({ rideId: RIDE, location: { lat: -26.1, lng: 28 } }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      contacts_notified: 1,
      safety_team_notified: true,
      share_url: "https://api.ridevura.com/share/token-1",
    });
  });
});
