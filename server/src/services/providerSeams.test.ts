// ─────────────────────────────────────────────────────────────────────────────
// PROVIDER SEAMS (Item 4) — the production rule, table-driven:
//   env set            -> that URL (source "env")
//   unset + dev        -> today's public demo (source "public-demo")
//   unset + production -> null (source "none"): callers fail honestly (503),
//                         never a silent public-demo call
// Plus SEARCH_PROVIDER parsing and the boot-log lines. Pure functions — no
// express, no network, no db.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  routeProvider,
  geocoderProvider,
  shareTileProvider,
  searchProviderChoice,
  describeProviderSeams,
  logProviderSeams,
} from "./providerSeams";

const DEMO_OSRM = "https://router.project-osrm.org";
const DEMO_NOMINATIM = "https://nominatim.openstreetmap.org";
const DEMO_TILES = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("routeProvider", () => {
  it("env set wins, trailing slashes stripped", () => {
    expect(routeProvider({ ROUTE_PROVIDER_URL: "http://maps:8080///" }, "production"))
      .toEqual({ url: "http://maps:8080", source: "env" });
  });

  it("production + unset -> null (never the public demo)", () => {
    expect(routeProvider({}, "production")).toEqual({ url: null, source: "none" });
  });

  it("dev + unset -> today's public demo", () => {
    expect(routeProvider({}, "development")).toEqual({ url: DEMO_OSRM, source: "public-demo" });
    expect(routeProvider({}, undefined)).toEqual({ url: DEMO_OSRM, source: "public-demo" });
  });
});

describe("geocoderProvider", () => {
  it("NOMINATIM_URL wins; production unset -> null; dev unset -> demo", () => {
    expect(geocoderProvider({ NOMINATIM_URL: "http://geo:8081" }, "production"))
      .toEqual({ url: "http://geo:8081", source: "env" });
    expect(geocoderProvider({}, "production")).toEqual({ url: null, source: "none" });
    expect(geocoderProvider({}, "development")).toEqual({ url: DEMO_NOMINATIM, source: "public-demo" });
  });
});

describe("shareTileProvider", () => {
  it("SHARE_TILE_URL wins; production unset -> null; dev unset -> demo", () => {
    expect(shareTileProvider({ SHARE_TILE_URL: "http://tiles/{z}/{x}/{y}.png" }, "production"))
      .toEqual({ url: "http://tiles/{z}/{x}/{y}.png", source: "env" });
    expect(shareTileProvider({}, "production")).toEqual({ url: null, source: "none" });
    expect(shareTileProvider({}, "development")).toEqual({ url: DEMO_TILES, source: "public-demo" });
  });
});

describe("searchProviderChoice", () => {
  it("unset/unknown = HERE then Nominatim (today's behaviour)", () => {
    expect(searchProviderChoice({})).toBe("here_then_nominatim");
    expect(searchProviderChoice({ SEARCH_PROVIDER: "google" })).toBe("here_then_nominatim");
  });

  it("here / nominatim are honoured case-insensitively", () => {
    expect(searchProviderChoice({ SEARCH_PROVIDER: "here" })).toBe("here_only");
    expect(searchProviderChoice({ SEARCH_PROVIDER: " Nominatim " })).toBe("nominatim_only");
  });
});

describe("boot log lines", () => {
  it("production + nothing set says NOT CONFIGURED for every URL seam", () => {
    const lines = describeProviderSeams({}, "production");
    expect(lines.filter((l) => l.includes("NOT CONFIGURED"))).toHaveLength(3);
    expect(lines.find((l) => l.startsWith("ROUTE_PROVIDER_URL"))).toMatch(/503/);
    expect(lines.find((l) => l.startsWith("SEARCH_PROVIDER"))).toContain("here_then_nominatim");
    expect(lines.find((l) => l.startsWith("SEARCH_PROVIDER"))).toContain("HERE_API_KEY absent");
  });

  it("dev + everything set prints each URL with its source", () => {
    const lines = describeProviderSeams(
      {
        ROUTE_PROVIDER_URL: "http://osrm:8080",
        NOMINATIM_URL: "http://nominatim:8081",
        SHARE_TILE_URL: "http://tiles:8082/{z}/{x}/{y}.png",
        SEARCH_PROVIDER: "nominatim",
        HERE_API_KEY: "key",
      },
      "production"
    );
    expect(lines[0]).toContain("http://osrm:8080 (env)");
    expect(lines[1]).toContain("http://nominatim:8081 (env)");
    expect(lines[2]).toContain("http://tiles:8082/{z}/{x}/{y}.png (env)");
    expect(lines[3]).toContain("nominatim_only");
    expect(lines[3]).toContain("HERE_API_KEY present");
  });

  it("dev + unset marks the demos as dev-only, never production", () => {
    const lines = describeProviderSeams({}, "development");
    expect(lines.filter((l) => l.includes("public demo — dev only"))).toHaveLength(3);
    expect(lines.some((l) => l.includes("NOT CONFIGURED"))).toBe(false);
  });

  it("logProviderSeams prints one header + one line per seam without throwing", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    logProviderSeams({}, "production");
    expect(spy).toHaveBeenCalledTimes(5); // header + 4 lines
    spy.mockRestore();
  });
});
