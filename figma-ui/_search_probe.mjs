// What does the rider's search box ACTUALLY receive from the live API?
//
//   node _search_probe.mjs ["Farmers"] ["-26.0314,28.0127"]
//
// Mints a throwaway rider and calls the exact endpoint, with the exact parameters, that
// the installed app calls - including the no-location and far-away variants - so the
// result order can be compared with HERE WeGo's own list instead of guessed at.
const API = "https://api.ridevura.com";
const KEY = "AIzaSyC3lSrWd0JHWS8FzyaW9h8GgQyzNK3sC3Q";
const IDENTITY = "https://identitytoolkit.googleapis.com/v1/accounts";
const PASSWORD = "FlowTest123!";

const Q = process.argv[2] || "Farmers";
const AT = process.argv[3] || "-26.0314,28.0127"; // Fourways, Johannesburg
const [lat, lng] = AT.split(",");

async function riderToken() {
  const email = `search-probe-${Date.now()}@vura-test.dev`;
  const su = await fetch(`${IDENTITY}:signUp?key=${KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: PASSWORD, returnSecureToken: true }),
  });
  const sj = await su.json();
  if (!sj.idToken) throw new Error("sign-up failed: " + JSON.stringify(sj).slice(0, 160));
  await fetch(API + "/api/users/sync", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + sj.idToken },
    body: JSON.stringify({ token: sj.idToken, role: "rider", full_name: "Search Probe", phone: "+27820000061" }),
  });
  return sj.idToken;
}

function show(label, json) {
  console.log("\n=== " + label + " ===");
  if (!json) { console.log("  no response"); return; }
  const rows = Array.isArray(json.items) ? json.items : Array.isArray(json.results) ? json.results : [];
  console.log("  provider=" + (json.provider || "?") + "  sort=" + (json.sort || "-") + "  items=" + rows.length +
    (json.queryTerms && json.queryTerms.length ? "  queryTerms=" + JSON.stringify(json.queryTerms) : ""));
  rows.slice(0, 8).forEach((r, i) => {
    console.log("  " + (i + 1) + ". " + (r.name || r.title || "?") +
      "  |  " + (r.address || "") +
      (r.distance !== undefined ? "  |  " + Math.round(r.distance) + " m" : "  |  no distance") +
      "  |  " + (r.resultType || "?") +
      (Number.isFinite(Number(r.lat)) ? "" : "   <-- DROPPED BY THE APP (no lat/lng)"));
  });
}

const token = await riderToken();
const auth = { Authorization: "Bearer " + token };

const p = (extra) => new URLSearchParams({ q: Q, limit: "10", ...extra }).toString();

const calls = [
  ["geocode WITH the rider's location (the normal path)", `/api/search/geocode?${p({ lat, lng, sort: "distance", country: "ZAF" })}`],
  ["geocode with NO location at all (no GPS fix)", `/api/search/geocode?${p({ sort: "distance", country: "ZAF" })}`],
  ["geocode with HERE relevance (sort=relevance)", `/api/search/geocode?${p({ lat, lng, sort: "relevance", country: "ZAF" })}`],
  ["geocode from 60 km away (does proximity reorder?)", `/api/search/geocode?${p({ lat: "-26.5", lng: "28.3", sort: "distance", country: "ZAF" })}`],
  ["discover (the Popular near you strip)", `/api/search/discover?${p({ lat, lng })}`],
];

for (const [label, path] of calls) {
  try {
    const res = await fetch(API + path, { headers: auth });
    let json = null;
    try { json = await res.json(); } catch { /* non-JSON */ }
    show(label + "  [HTTP " + res.status + "]", json && json.error ? null : json);
    if (json && json.error) console.log("  error: " + json.error);
  } catch (err) {
    console.log("\n=== " + label + " ===\n  request failed: " + err.message);
  }
}
process.exit(0);
