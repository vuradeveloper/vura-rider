// The public share page is a hand-written HTML/JS string. A missing IIFE close
// or a missing tick() call is invisible to TypeScript and to every API test —
// the page just renders "Loading your trip…" forever. The live page had both
// faults (no `})();`, no `tick();`). This test pins the whole contract:
//   • the inline script parses as JavaScript;
//   • the poller is started immediately and on a 3 s interval;
//   • a Leaflet/CDN failure cannot replace the trip card with an error page.
import { describe, it, expect } from "vitest";
import { shareLocationHidden, sharePage, shareRidePayload } from "./share";

describe("public share page privacy", () => {
  const ride = {
    id: "ride-1",
    status: "in_progress",
    driver_id: "driver-1",
    pickup_lat: -26.1,
    pickup_lng: 28.05,
    destination_lat: -26.14,
    destination_lng: 28.24,
    driver_lat: -26.11,
    driver_lng: 28.06,
    driver_heading: 45,
    driver_name: "Driver",
    driver_rating: 4.9,
  };

  it("never exposes driver coordinates after the trip is over or sharing stops", () => {
    expect(shareLocationHidden("completed", false)).toBe(true);
    expect(shareLocationHidden("cancelled", false)).toBe(true);
    expect(shareLocationHidden("expired", false)).toBe(true);
    expect(shareLocationHidden("in_progress", true)).toBe(true);
    expect(shareLocationHidden("accepted", false)).toBe(false);
    expect(shareLocationHidden("in_progress", false)).toBe(false);

    const done = shareRidePayload({ ...ride, status: "completed" }, false);
    expect(done.tripDone).toBe(true);
    expect(done.driverLat).toBeNull();
    expect(done.driverLng).toBeNull();
    expect(done.driverHeading).toBeNull();

    const stopped = shareRidePayload(ride, true);
    expect(stopped.driverLat).toBeNull();
    expect(stopped.driverLng).toBeNull();
    expect(stopped.driverHeading).toBeNull();

    const live = shareRidePayload(ride, false);
    expect(live.tripDone).toBe(false);
    expect(live.driverLat).toBe(-26.11);
    expect(live.driverLng).toBe(28.06);
  });
});

describe("public share page", () => {
  it("parses and starts the live poller", async () => {
    let html = "";
    const headers: Record<string, string> = {};
    const res: any = {
      set: (key: string, value: string) => { headers[key] = value; },
      send: (body: string) => { html = body; },
    };
    await sharePage({ params: { token: "test-token" } } as any, res);

    expect(headers["Cache-Control"]).toContain("no-store");
    // Helmet's default script-src 'self' blocked the inline poller + Leaflet,
    // which is what made every live link sit on "Loading your trip…".
    expect(headers["Content-Security-Policy"]).toContain("'unsafe-inline'");
    expect(headers["Content-Security-Policy"]).toContain("https://unpkg.com");
    expect(headers["Content-Security-Policy"]).toContain("connect-src 'self'");
    expect(html).toContain("Loading your trip");
    expect(html).toContain("tile-grayscale");
    expect(html).toContain("vura-roam-car");
    expect(html).toContain("driverPhotoUrl");
    expect(html).toContain("driverRating");
    expect(html).toContain("licensePlate");
    // Brand + professional layout: white page, Vura wordmark, structured route.
    expect(html).toContain("/api/share/logo.png");
    expect(html).toContain("Trip route");
    expect(html).toContain("Pickup");
    expect(html).toContain("Drop-off");
    expect(html).not.toContain(".header{");
    expect(html).not.toContain("linear-gradient(135deg");
    // Completed trips keep a permanent "Trip is done" view and drop the car.
    expect(html).toContain("Trip is done");
    expect(html).toContain("Trip summary");
    expect(html).toContain("Vura — Trip completed");
    expect(html).toContain("Live location sharing is off");
    expect(html).toContain("removeCar");
    expect(html).toContain("tick();");
    expect(html).toContain("setInterval(tick, 3000);");
    expect(html).toContain("})();");
    expect(html).toContain("try { initMap(r); }");

    const match = html.match(/<script>\s*([\s\S]*?)<\/script>\s*<\/body>/);
    expect(match).toBeTruthy();
    // Parses the exact inline program without running it (no DOM/fetch here).
    expect(() => new Function(match![1])).not.toThrow();
  });
});
