// Does the LIVE server resolve a South African bank account (currency=ZAR)?
//
//   node _bank_resolve_live.mjs <driverEmail> <driverPass> [accountNumber] [bankCode]
//   defaults: 2362094142 / 470010 (Capitec - the details from the driver Wallet screen)
//
// Why: POST /api/payouts/resolve used to call Paystack's /bank/resolve WITHOUT a
// currency, so Paystack assumed NGN and answered
//   Please supply one of the following valid currencies: NGN, USD, GHS, KES
// which is what the driver's "Verify account" button showed. The fix sends
// currency=ZAR (and uses the basa recipient type for ZAR).
//
// Reading the result:
//   "valid currencies"          -> the currency=ZAR fix is NOT deployed yet
//   account_name / recipient    -> fix deployed AND Paystack resolved the account
//   any other ZAR-specific text -> fix deployed, but the Paystack business itself
//                                  does not have ZAR transfers enabled (support)
const API = 'https://api.ridevura.com';
const KEY = 'AIzaSyC3lSrWd0JHWS8FzyaW9h8GgQyzNK3sC3Q';
const IDENTITY = 'https://identitytoolkit.googleapis.com/v1/accounts';

const [email, pass, accountNumber = '2362094142', bankCode = '470010'] = process.argv.slice(2);
if (!email || !pass) { console.log('usage: node _bank_resolve_live.mjs <driverEmail> <driverPass> [accountNumber] [bankCode]'); process.exit(1); }

const signIn = await fetch(`${IDENTITY}:signInWithPassword?key=${KEY}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password: pass, returnSecureToken: true }),
});
const sj = await signIn.json();
if (!sj.idToken) { console.log('sign-in failed: ' + (sj.error?.message || JSON.stringify(sj))); process.exit(2); }

const res = await fetch(API + '/api/payouts/resolve', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + sj.idToken },
  body: JSON.stringify({ bankCode, accountNumber, bankName: 'Capitec Bank' }),
});
const body = await res.text();
console.log(`POST /api/payouts/resolve ${accountNumber} / ${bankCode} -> HTTP ${res.status}`);
console.log(body.slice(0, 600));

if (/valid currencies/i.test(body)) {
  console.log('VERDICT: the currency=ZAR fix is NOT live yet - this is the driver Wallet error');
  process.exit(3);
}
if (res.status === 200 && /account_name|recipient_code/.test(body)) {
  console.log('VERDICT: currency=ZAR fix IS live and Paystack resolved the account');
  process.exit(0);
}
console.log('VERDICT: the fix is live (different failure) - read the message above; if it names ZAR, the Paystack business needs ZAR transfers enabled');
