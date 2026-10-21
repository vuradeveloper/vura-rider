// LIVE E2E: does the referral code work when applied AT SIGNUP?
// (Exactly what the app now sends: signUp() → POST /api/users/sync {referralCode}.)
//   1. inviter fetches their code
//   2. a FRESH account signs up with the code in the sync body → must show PENDING
//   3. that rider takes 1 real ride → inviter must gain another R5 (5 → 10)
//   4. edge: the SAME user re-syncs with the code again → no double referral
//   5. edge: a user signing up with their OWN code → signup succeeds, NO self-referral
// Usage: node _signup_ref_e2e.mjs
const API = "https://api.ridevura.com";
const KEY = "AIzaSyC3lSrWd0JHWS8FzyaW9h8GgQyzNK3sC3Q";
const PASS = "VuraInvite2026!";
const INVITER = "vurainvitertest.inviter@gmail.com";
const SIGNUP2 = "vurainvitertest.signup2@gmail.com";
const DRIVER = "specials39u7@gmail.com";
const DRIVER_PASS = "Makhavhu@77";

const log = (...a) => console.log(...a);
const fail = (m) => { console.error("FAIL: " + m); process.exit(1); };

const fb = async (call, body) => {
  const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:${call}?key=${KEY}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  const j = await r.json();
  if (!j.idToken) fail(`firebase ${call}: ${JSON.stringify(j).slice(0, 250)}`);
  return j;
};
const signIn = (email, pass) =>
  fb("signInWithPassword", { email, password: pass || PASS, returnSecureToken: true });
const signUpMaybe = async (email) => {
  const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${KEY}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: PASS, returnSecureToken: true }),
  });
  const j = await r.json().catch(() => ({}));
  return j.idToken || null;
};
const api = async (path, token, method = "GET", body) => {
  const r = await fetch(API + path, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let j = null; try { j = await r.json(); } catch { /* empty */ }
  return { status: r.status, json: j };
};
// The app's exact signup payload (backend.ts signUp → syncWithBackend).
const sync = (token, name, referralCode) =>
  api("/api/users/sync", token, "POST", { token, role: "passenger", full_name: name, phone: "", ...(referralCode ? { referralCode } : {}) });

async function main() {
  log("1) inviter code");
  const inviterTok = (await signIn(INVITER)).idToken;
  const reg = await api("/api/affiliates/register", inviterTok, "POST");
  const code = reg.json?.affiliate?.referral_code;
  if (!code) fail("no inviter code");
  const before = await api("/api/affiliates/me", inviterTok);
  log("   code:", code, "| balance BEFORE:", before.json?.affiliate?.balance, "| settled:", before.json?.affiliate?.settled_referrals);
  const beforeBal = Number(before.json?.affiliate?.balance || 0);

  log("2) FRESH signup WITH the code in the sync body");
  const t2 = (await signUpMaybe(SIGNUP2)) || (await signIn(SIGNUP2)).idToken;
  const s2 = await sync(t2, "Signup Ref Tester", code);
  log("   sync:", s2.status, JSON.stringify(s2.json?.user || s2.json).slice(0, 120));
  const refs1 = await api("/api/affiliates/me/referrals", inviterTok);
  const mine = (refs1.json?.referrals || []).filter((r) => r.referred_email === SIGNUP2);
  log("   referral rows for signup2:", JSON.stringify(mine.map((r) => ({ status: r.status, who: r.referred_email }))));
  if (!mine.length || mine[0].status !== "pending") fail("signup with code did NOT create a pending referral");

  log("3) re-sync same user with the SAME code (idempotency)");
  const s2b = await sync(t2, "Signup Ref Tester", code);
  log("   sync again:", s2b.status, JSON.stringify(s2b.json?.user ? "ok" : s2b.json).slice(0, 80));
  const refs2 = await api("/api/affiliates/me/referrals", inviterTok);
  const rows = (refs2.json?.referrals || []).filter((r) => r.referred_email === SIGNUP2);
  log("   referral rows now:", rows.length, "(must be 1)");
  if (rows.length !== 1) fail("double referral created!");

  log("4) edge: a user signs up with THEIR OWN code (must not self-refer)");
  const inviterSelfSync = await sync(inviterTok, "Invite Tester", code);
  log("   own-code sync:", inviterSelfSync.status, JSON.stringify(inviterSelfSync.json?.user ? "signup/session still OK" : inviterSelfSync.json).slice(0, 120));
  const refs3 = await api("/api/affiliates/me/referrals", inviterTok);
  const selfRows = (refs3.json?.referrals || []).filter((r) => r.referred_email === INVITER);
  log("   self-referral rows:", selfRows.length, "(must be 0)");
  if (selfRows.length) fail("self-referral was created!");

  log("5) signup2 takes 1 real ride (driver online → accept → start → complete)");
  const driverTok = (await signIn(DRIVER, DRIVER_PASS)).idToken;
  const on = await api("/api/drivers/online", driverTok, "POST", { online: true });
  log("   driver online:", on.status, JSON.stringify(on.json));
  if (!on.json?.ok) fail("driver offline");
  const ride = await api("/api/rides/request", t2, "POST", {
    pickupAddress: "Signup test pickup", pickupLat: -33.9248, pickupLng: 18.4240,
    destinationAddress: "Signup test dropoff", destinationLat: -33.9257, destinationLng: 18.4259,
    paymentMethod: "cash", fare: 11.0,
  });
  log("   ride:", ride.status, JSON.stringify(ride.json));
  const rideId = ride.json?.rideId;
  if (!rideId) fail("no rideId");
  for (const [label, path, method, body] of [
    ["accept", `/api/rides/${rideId}/accept`, "POST", undefined],
    ["in_progress", `/api/rides/${rideId}/status`, "PATCH", { status: "in_progress" }],
    ["completed", `/api/rides/${rideId}/status`, "PATCH", { status: "completed" }],
  ]) {
    const r = await api(path, driverTok, method, body);
    log(`   ${label}: ${r.status}`);
  }

  const after = await api("/api/affiliates/me", inviterTok);
  const txs = await api("/api/affiliates/me/transactions", inviterTok);
  const a = after.json?.affiliate;
  const afterBal = Number(a?.balance || 0);
  log("==================================================");
  log("balance:", beforeBal, "->", afterBal, "| settled:", a?.settled_referrals, "| total_earned:", a?.total_earned);
  log("transactions:", JSON.stringify((txs.json?.transactions || []).map((t) => ({ type: t.type, amount: t.amount }))));
  const ok = afterBal === beforeBal + 5 && Number(a?.settled_referrals) >= 2;
  log(ok
    ? "PASS: code applied AT SIGNUP -> referral pending -> first ride -> another R5 paid"
    : "FAIL: signup-path referral did not pay out");
  process.exit(ok ? 0 : 2);
}
main().catch((e) => fail(e.message));
