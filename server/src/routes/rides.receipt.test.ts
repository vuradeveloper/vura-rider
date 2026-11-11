import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";

const db = vi.hoisted(() => ({
  query: vi.fn(async () => []),
  queryOne: vi.fn(),
  execute: vi.fn(async () => ({ rowCount: 1, rows: [] })),
}));
const vehicles = vi.hoisted(() => ({
  attachVehicleImages: vi.fn(async (row: any) => {
    if (row) row.vehicle_image_url = "/api/vehicle-images/car.webp";
    return row;
  }),
}));
const driverPhoto = vi.hoisted(() => ({
  resolveDriverPhotoUrl: vi.fn(async () => "https://cdn.test/driver.jpg"),
}));

vi.mock("../config/database", () => db);
vi.mock("../services/vehicleImages", () => vehicles);
vi.mock("../services/driverPhoto", () => driverPhoto);
vi.mock("../middleware/auth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.userId = "firebase-1";
    next();
  },
}));

import ridesRouter from "./rides";

const RIDE = "11111111-1111-4111-8111-111111111111";
let server: any;
let base = "";

beforeEach(async () => {
  db.query.mockReset();
  db.query.mockResolvedValue([]);
  db.queryOne.mockReset();
  db.execute.mockClear();
  vehicles.attachVehicleImages.mockClear();
  driverPhoto.resolveDriverPhotoUrl.mockClear();

  const app = express();
  app.use(express.json());
  app.use("/api/rides", ridesRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  base = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
});

afterEach(() => server?.close());

const auth = { Authorization: "Bearer t" };

describe("ride receipt privacy", () => {
  it("does not return another rider's receipt", async () => {
    db.queryOne.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM users WHERE firebase_uid")) return { id: "user-1" };
      if (sql.includes("FROM rides r")) return null; // the OR-owner filter rejected it
      return null;
    });

    const res = await fetch(`${base}/api/rides/${RIDE}/receipt`, { headers: auth });
    expect(res.status).toBe(404);

    // The ownership filter is part of the query, not a client-side check.
    const rideCall = db.queryOne.mock.calls.find(([sql]) => String(sql).includes("FROM rides r"));
    expect(String(rideCall?.[0])).toContain("r.passenger_id = $2 OR r.driver_id = $2");
    expect(rideCall?.[1]).toEqual([RIDE, "user-1"]);
    expect(vehicles.attachVehicleImages).not.toHaveBeenCalled();
  });

  it("returns the map coordinates, car and driver details to the rider", async () => {
    db.queryOne.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM users WHERE firebase_uid")) return { id: "user-1" };
      if (sql.includes("FROM rides r")) {
        return {
          id: RIDE,
          ride_id: RIDE,
          passenger_id: "user-1",
          driver_id: "driver-1",
          pickup_address: "Rosebank",
          destination_address: "OR Tambo",
          pickup_lat: "-26.1467",
          pickup_lng: "28.0417",
          destination_lat: "-26.1391",
          destination_lng: "28.2460",
          waypoints: [],
          route_data: null,
          fare: "5.00",
          booking_fee: "0.20",
          ride_request_fee: "0.50",
          payment_method: "card",
          payment_status: "completed",
          driver_name: "Thabo M",
          driver_phone: "0820000000",
          driver_photo_url: null,
          vehicle_make: "Toyota",
          vehicle_model: "Corolla",
          vehicle_color: "White",
          license_plate: "CA 123 456",
          vehicle_body_type: "sedan",
          vehicle_year: 2021,
          driver_rating: "4.90",
          receipt_number: `${RIDE}-20261111`,
        };
      }
      if (sql.includes("affiliate_credit")) return { affiliate_credit: 0 };
      return null;
    });

    const res = await fetch(`${base}/api/rides/${RIDE}/receipt`, { headers: auth });
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.receipt).toMatchObject({
      pickup_lat: "-26.1467",
      pickup_lng: "28.0417",
      destination_lat: "-26.1391",
      destination_lng: "28.2460",
      driver_name: "Thabo M",
      vehicle_make: "Toyota",
      vehicle_model: "Corolla",
      vehicle_color: "White",
      license_plate: "CA 123 456",
      vehicle_body_type: "sedan",
      driver_rating: "4.90",
      vehicle_image_url: "/api/vehicle-images/car.webp",
      driver_photo_url: "https://cdn.test/driver.jpg",
    });
    expect(vehicles.attachVehicleImages).toHaveBeenCalledTimes(1);
    expect(driverPhoto.resolveDriverPhotoUrl).toHaveBeenCalledWith("driver-1", null);
  });
});
