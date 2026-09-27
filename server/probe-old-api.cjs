/**
 * Vura — READ-ONLY probe of the OLD account's backend.
 *
 * The old Elastic Beanstalk env (account 456097556241) is still running and publicly
 * reachable, and both backends share one Firebase project (vura-f667d). So we can mint
 * an ID token from the project's service account and ask the OLD backend what data it
 * holds — no AWS sign-in, no passwords, no DB client needed.
 *
 *   cd server
 *   node _probe_old_api.cjs                      # tries ridevura@gmail.com, then the operator Gmail
 *   node _probe_old_api.cjs other@example.com    # or pick the addresses yourself
 *
 * Env overrides: SA_JSON, OLD_HOST, FB_KEY.
 * GET requests only — nothing is written, in the DB or anywhere else.
 * The full responses land in %TEMP%/vura_old_probe.json.
 */
const path = require("path");
const fs = require("fs");
const os = require("os");
const admin = require("firebase-admin");

const SA = process.env.SA_JSON ||
  path.join(os.homedir(), "Downloads", "vura-f667d-firebase-adminsdk-fbsvc-126097dcc5.json");
const OLD = process.env.OLD_HOST ||
  "http://vura-rider-prod-cape2.eba-heeiam6b.af-south-1.elasticbeanstalk.com";
const API_KEY = process.env.FB_KEY || "AIzaSyC3lSrWd0JHWS8FzyaW9h8GgQyzNK3sC3Q";

const EMAILS = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ["ridevura@gmail.com", "nhlanhlabhengu99@gmail.com"];

// [path, what a 200 proves]
const GETS = [
  ["/api/admin/analytics", "admin: totals over the whole old DB"],
  ["/api/rides/available", "authenticated non-admin call"],
];

admin.initializeApp({ credential: admin.credential.cert(require(SA)) });

async function tokenFor(email) {
  const user = await admin.auth().getUserByEmail(email);
  const custom = await admin.auth().createCustomToken(user.uid);
  const res = await fetch(
    "https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=" + API_KEY,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: custom, returnSecureToken: true }),
    }
  );
  const j = await res.json();
  if (!j.idToken) throw new Error("token exchange failed: " + JSON.stringify(j).slice(0, 300));
  return {
    idToken: j.idToken,
    uid: user.uid,
    disabled: !!user.disabled,
    providers: (user.providerData || []).map((p) => p.providerId).join(",") || "none",
  };
}

async function get(token, p) {
  const res = await fetch(OLD + p, { headers: { Authorization: "Bearer " + token } });
  const text = await res.text();
  let parsed = text;
  try { parsed = JSON.parse(text); } catch { /* leave as text */ }
  return { status: res.status, parsed };
}

(async () => {
  console.log("service account :", SA);
  console.log("old backend     :", OLD);
  const dump = {};
  for (const email of EMAILS) {
    console.log("\n================ " + email + " ================");
    let t;
    try {
      t = await tokenFor(email);
    } catch (err) {
      console.log("  ✗ no token: " + (err.code || err.message));
      continue;
    }
    console.log("  uid " + t.uid + " · providers: " + t.providers + (t.disabled ? "  [FIREBASE ACCOUNT DISABLED]" : ""));
    for (const [p, why] of GETS) {
      const r = await get(t.idToken, p);
      const body = typeof r.parsed === "string"
        ? r.parsed.slice(0, 200)
        : JSON.stringify(r.parsed).slice(0, 400);
      console.log(`  HTTP ${r.status}  ${p}   (${why})`);
      console.log("        " + body);
      dump[email + " " + p] = r.parsed;
      if (p === "/api/admin/analytics" && r.status === 200) {
        const tt = r.parsed.totals || {};
        console.log(`        ⇒ OLD DB: rides=${tt.totalRides} revenue=R${tt.totalRevenue} riders=${tt.riders} drivers=${tt.drivers}`);
      }
    }
  }
  const out = path.join(os.tmpdir(), "vura_old_probe.json");
  fs.writeFileSync(out, JSON.stringify(dump, null, 2));
  console.log("\nfull responses written to " + out);
})().catch((err) => { console.error("probe failed:", err); process.exit(1); });
