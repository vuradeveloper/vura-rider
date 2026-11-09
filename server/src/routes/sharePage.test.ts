// The public share page is a hand-written HTML/JS string. A missing IIFE close
// or a missing tick() call is invisible to TypeScript and to every API test —
// the page just renders "Loading your trip…" forever. The live page had both
// faults (no `})();`, no `tick();`). This test pins the whole contract:
//   • the inline script parses as JavaScript;
//   • the poller is started immediately and on a 3 s interval;
//   • a Leaflet/CDN failure cannot replace the trip card with an error page.
import { describe, it, expect } from "vitest";
import { sharePage } from "./share";

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
    expect(html).toContain("Loading your trip");
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
