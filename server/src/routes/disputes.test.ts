import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";

const db = vi.hoisted(() => ({
  queryOne: vi.fn(),
  query: vi.fn(),
  execute: vi.fn(async () => ({ rowCount: 0, rows: [] })),
}));

vi.mock("../config/database", () => db);
vi.mock("../middleware/auth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.userId = "fb-driver";
    next();
  },
}));

import disputesRouter from "./disputes";

const RIDE_ID = "11111111-1111-4111-8111-111111111111";

let server: any;
let base = "";

beforeEach(async () => {
  db.queryOne.mockReset();
  db.query.mockReset();
  db.execute.mockClear();

  db.queryOne.mockImplementation(async (sql: string) => {
    if (sql.includes("FROM users")) return { id: "user-1" };
    if (sql.includes("FROM rides")) return { id: RIDE_ID };
    if (sql.includes("COUNT(*)::int")) return { n: 0 };
    if (sql.includes("INSERT INTO disputes")) {
      return {
        id: "ticket-1",
        ride_id: RIDE_ID,
        type: "account_access",
        reason: "Account access / deactivation",
        description: "My account was blocked and I need a human review.",
        status: "open",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
    }
    return null;
  });
  db.query.mockImplementation(async () => [
    {
      id: "ticket-1",
      ride_id: RIDE_ID,
      type: "account_access",
      reason: "Account access / deactivation",
      description: "My account was blocked and I need a human review.",
      status: "resolved",
      resolution: "Account restored after ID check.",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      resolved_at: new Date().toISOString(),
    },
  ]);

  const app = express();
  app.use(express.json());
  app.use("/api/disputes", disputesRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  base = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
});

describe("driver support tickets", () => {
  it("creates an account-access appeal and returns a reference", async () => {
    const res = await fetch(`${base}/api/disputes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "account_access",
        description: "My account was blocked and I need a human review.",
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.dispute.id).toBe("ticket-1");
    expect(body.dispute.type).toBe("account_access");
    expect(db.queryOne).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO disputes"),
      [null, "user-1", "account_access", "Account access / deactivation", "My account was blocked and I need a human review."]
    );
  });

  it("rejects a one-word description", async () => {
    const res = await fetch(`${base}/api/disputes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "payout", description: "help" }),
    });
    expect(res.status).toBe(400);
  });

  it("rejects a ride that is not on the user's account", async () => {
    db.queryOne.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM users")) return { id: "user-1" };
      if (sql.includes("FROM rides")) return null;
      return null;
    });
    const res = await fetch(`${base}/api/disputes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "trip",
        rideId: RIDE_ID,
        description: "The fare on this trip looks wrong.",
      }),
    });
    expect(res.status).toBe(403);
  });

  it("returns status and resolution to the driver", async () => {
    const res = await fetch(`${base}/api/disputes`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.disputes[0]).toMatchObject({
      status: "resolved",
      resolution: "Account restored after ID check.",
    });
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining("SELECT id, ride_id, type, reason, description, status, resolution"),
      ["user-1"]
    );
  });
});

afterEach(() => {
  server?.close();
});
