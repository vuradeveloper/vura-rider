// LIVE E2E: does "Invite & earn" actually pay out? (creates 2 test riders + 1 cash ride)
//   inviter registers code → invitee claims → invitee takes 1 real ride → inviter must get R5
// Usage: node _invite_e2e.mjs
const API = "https://api.ridevura.com";
const KEY = "AIzaSyC3lSrWd0JHWS8FzyaW9h8GgQyzNK3sC3Q";
const PASS = "VuraInvite2026!";
const INVITER = "vurainvitertest.inviter@gmail.com";
const INVITEE = "vurainvitertest.invitee@gmail.com";
const DRIVER = "specials39u7@gmail.com";
const DRIVER_PASS = "Makhavhu@77";

const log = (...a) => console.log(...a);
const fail = (m) => { console.error("❌ " + m); process.exit(1); };

const fb = async (call, body) => {
  const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:${call}?key=${KEY}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  const j = await r.json();
  if (!j.idToken) fail(`firebase ${call}: ${JSON.stringify(j).slice(0, 300)}`);
  return j;
};
const signIn = (email) => fb("signInWithPassword", { email, password: PASS, returnSecureToken: true });

const api = async (path, token, method = "GET", body) => {
  const r = await fetch(API + path, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let j = null; try { j = await r.json(); } catch { /* empty */ }
  return { status: r.status, json: j };
};
const sync = (token, name) =>
  api("/api/users/sync", token, "POST", { token, role: "passenger", full_name: name, phone: "" });

async function main() {
  log("1) accounts");
  const signUpMaybe = async (email) => {
    const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${KEY}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: PASS, returnSecureToken: true }),
    });
    const j = await r.json().catch(() => ({}));
    return j.idToken || null; // null = EMAIL_EXISTS (or other) → caller signs in instead
  };
  const ensure = async (email) => {
    const created = await signUpMaybe(email);
    if (created) { log("   created + signed in"); return created; }
    log("   (already existed, signed in)");
    return (await signIn(email)).idToken;
  };
  const inviterTok = await ensure(INVITER);
  const inviteeTok = await ensure(INVITEE);
  const driverTok = (await fb("signInWithPassword", { email: DRIVER, password: DRIVER_PASS, returnSecureToken: true })).idToken;
  log("   all signed in");
  log("   inviter sync:", JSON.stringify((await sync(inviterTok, "Invite Tester")).json).slice(0, 100));
  log("   invitee sync:", JSON.stringify((await sync(inviteeTok, "Invite Friend")).json).slice(0, 100));

  log("2) register affiliate code");
  const reg = await api("/api/affiliates/register", inviterTok, "POST");
  log("   ", reg.status, JSON.stringify(reg.json).slice(0, 220));
  const code = reg.json?.affiliate?.referral_code;
  if (!code) fail("no referral_code returned");
  const before = await api("/api/affiliates/me", inviterTok);
  log("   code:", code, "| balance BEFORE:", before.json?.affiliate?.balance);

  log("3) invitee claims the code");
  const claim = await api("/api/affiliates/claim", inviteeTok, "POST", { code });
  log("   ", claim.status, JSON.stringify(claim.json));
  const refs1 = await api("/api/affiliates/me/referrals", inviterTok);
  log("   referrals:", JSON.stringify((refs1.json?.referrals || []).map((r) => ({ status: r.status, who: r.referred_email }))));

  log("4) driver online");
  const on = await api("/api/drivers/online", driverTok, "POST", { online: true });
  log("   ", on.status, JSON.stringify(on.json));
  if (!on.json?.ok) fail("driver could not go online: " + JSON.stringify(on.json));

  log("5) invitee books a cash ride (R12.50)");
  const ride = await api("/api/rides/request", inviteeTok, "POST", {
    pickupAddress: "Cape Town Test pickup", pickupLat: -33.9249, pickupLng: 18.4241,
    destinationAddress: "Cape Town Test dropoff", destinationLat: -33.9258, destinationLng: 18.4260,
    paymentMethod: "cash", fare: 12.5,
  });
  log("   ", ride.status, JSON.stringify(ride.json));
  const rideId = ride.json?.rideId;
  if (!rideId) fail("no rideId");

  log("6) driver accepts → starts → completes (REST)");
  for (const [label, path, method, body] of [
    ["accept", `/api/rides/${rideId}/accept`, "POST", undefined],
    ["in_progress", `/api/rides/${rideId}/status`, "PATCH", { status: "in_progress" }],
    ["completed", `/api/rides/${rideId}/status`, "PATCH", { status: "completed" }],
  ]) {
    const r = await api(path, driverTok, method, body);
    log(`   ${label}: ${r.status} ${JSON.stringify(r.json)?.slice(0, 160)}`);
  }
  const rideAfter = await api(`/api/rides/${rideId}`, inviteeTok);
  log("7) ride after:", rideAfter.json?.status, "| fare:", rideAfter.json?.actual_fare ?? rideAfter.json?.estimated_fare);

  const after = await api("/api/affiliates/me", inviterTok);
  const refs2 = await api("/api/affiliates/me/referrals", inviterTok);
  const txs = await api("/api/affiliates/me/transactions", inviterTok);
  const a = after.json?.affiliate;
  log("════════════════════════════════════════");
  log("MONEY-IN: balance =", a?.balance, "| settled =", a?.settled_referrals, "| total_earned =", a?.total_earned);
  log("referrals:", JSON.stringify((refs2.json?.referrals || []).map((r) => ({ status: r.status, rewarded: r.rewarded_amount }))));
  log("transactions:", JSON.stringify((txs.json?.transactions || []).map((t) => ({ type: t.type, amount: t.amount }))));
  const moneyIn = Number(a?.balance) === 5 && Number(a?.settled_referrals) >= 1;
  log(moneyIn ? "✅ R5 PAID: invitee rode once → inviter balance is R5" : "❌ MONEY DID NOT GO IN");
  if (!moneyIn) process.exit(2);

  // ── the "if you choose to" half: the inviter SPENDS the R5 on their own trip ──
  log("8) inviter books their OWN ride with invite credit ON (fare 12.50 → expect 7.50)");
  const ride2 = await api("/api/rides/request", inviterTok, "POST", {
    pickupAddress: "Cape Town Test pickup2", pickupLat: -33.9250, pickupLng: 18.4251,
    destinationAddress: "Cape Town Test dropoff2", destinationLat: -33.9260, destinationLng: 18.4261,
    paymentMethod: "cash", fare: 12.5, useAffiliateCredit: true,
  });
  log("   ", ride2.status, JSON.stringify(ride2.json));
  const credited = Number(ride2.json?.appliedInviteCredit ?? -1);
  const ride2Id = ride2.json?.rideId;

  if (ride2Id) {
    for (const [label, path, method, body] of [
      ["accept", `/api/rides/${ride2Id}/accept`, "POST", undefined],
      ["in_progress", `/api/rides/${ride2Id}/status`, "PATCH", { status: "in_progress" }],
      ["completed", `/api/rides/${ride2Id}/status`, "PATCH", { status: "completed" }],
    ]) {
      const r = await api(path, driverTok, method, body);
      log(`   ${label}: ${r.status} ${JSON.stringify(r.json)?.slice(0, 120)}`);
    }
  }
  const finalMe = await api("/api/affiliates/me", inviterTok);
  const finalTx = await api("/api/affiliates/me/transactions", inviterTok);
  const fb2 = finalMe.json?.affiliate;
  log("════════════════════════════════════════");
  log("SPEND: appliedInviteCredit =", credited, "| balance after =", fb2?.balance);
  log("transactions:", JSON.stringify((finalTx.json?.transactions || []).map((t) => ({ type: t.type, amount: t.amount }))));
  const spentOk = credited === 5 && Number(fb2?.balance) === 0;
  log(spentOk ? "✅ R5 SPENT: booking discounted the inviter's trip by R5 and the balance went to R0" : "⚠️  SPEND NOT VERIFIED (server may predate the deploy — run after 'bash deploy/deploy.sh')");
  process.exit(spentOk ? 0 : 3);
}
main().catch((e) => fail(e.message));
