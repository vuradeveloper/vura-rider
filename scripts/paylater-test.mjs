// Pay Later terminal test harness.
//
// Usage:
//   PAYLATER_EMAIL=you@example.com PAYLATER_PASSWORD=yourpass node scripts/paylater-test.mjs
//
// (or it will prompt interactively). The script mints a Firebase ID token via
// the REST API, then walks the whole flow against the local backend:
//   status → enroll → simulate a ride → status → pay → collect.

import { createInterface } from "node:readline";

const API = process.env.PAYLATER_API || "http://localhost:3000";
const FIREBASE_API_KEY = "AIzaSyC3lSrWd0JHWS8FzyaW9h8GgQyzNK3sC3Q";
const SIGN_IN_URL = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${FIREBASE_API_KEY}`;

async function prompt(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) =>
    rl.question(question, (a) => {
      rl.close();
      resolve(a);
    })
  );
}

async function getToken() {
  const email =
    process.env.PAYLATER_EMAIL || (await prompt("Firebase email: "));
  const password =
    process.env.PAYLATER_PASSWORD || (await prompt("Firebase password: "));
  const res = await fetch(SIGN_IN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  if (!res.ok) {
    const e = await res.json();
    throw new Error(`Sign-in failed: ${e.error?.message || res.status}`);
  }
  const data = await res.json();
  return data.idToken;
}

async function call(token, method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  if (!res.ok) {
    throw new Error(`${method} ${path} → ${res.status}: ${json.error || text}`);
  }
  return json;
}

const log = (label, value) => {
  console.log(`\n── ${label} ──`);
  console.log(JSON.stringify(value, null, 2));
};

const token = await getToken();
console.log("✓ Authenticated with Firebase\n");

// 1. Status
const before = await call(token, "GET", "/api/payments/pay-later/status");
log("1. Status (before)", before);

// 2. Enroll (mock bypasses the 10-ride gate)
if (!before.enrolled) {
  const enrolled = await call(token, "POST", "/api/payments/pay-later/enroll", {
    accountHolder: "Test Rider",
    bankCode: "470010",
    accountNumber: "1234567890",
  });
  log("2. Enroll", enrolled);
} else {
  log("2. Enroll", "already enrolled — skipping");
}

// 3. Find a completed ride to simulate
const history = await call(token, "GET", "/api/rides/history?page=1&limit=50");
const completed = (history.rides || []).filter(
  (r) => r.status === "completed" && r.payment_method !== "pay_later"
);
if (completed.length === 0) {
  console.log("\n⚠ No completed ride found to simulate. Complete a ride in the app first.");
  process.exit(1);
}
const ride = completed[0];
const simulated = await call(token, "POST", "/api/payments/pay-later/dev/simulate", {
  rideId: ride.id,
});
log("3. Simulate pay-later ride", simulated);

// 4. Status again
const mid = await call(token, "GET", "/api/payments/pay-later/status");
log("4. Status (after simulate)", mid);

// 5. Manual pay
const paid = await call(token, "POST", `/api/payments/pay-later/${ride.id}/pay`);
log("5. Manual pay", paid);

// 6. Run the month-end collection job
const collected = await call(token, "POST", "/api/payments/pay-later/collect");
log("6. Month-end collect", collected);

// 7. Final status
const after = await call(token, "GET", "/api/payments/pay-later/status");
log("7. Status (final)", after);

console.log("\n✓ Done. To test the overdue path, set PAYMENTS_MOCK_FAIL_COLLECT=1");
console.log("  in server/.env, restart the server, and re-run this script.");
