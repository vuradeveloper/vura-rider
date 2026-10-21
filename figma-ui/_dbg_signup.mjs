const KEY = "AIzaSyC3lSrWd0JHWS8FzyaW9h8GgQyzNK3sC3Q";
const EMAIL = process.argv[2] || "vurainvitertest.inviter@gmail.com";
const PASS = "VuraInvite2026!";
const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${KEY}`, {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email: EMAIL, password: PASS, returnSecureToken: true }),
});
console.log("signUp:", (await r.text()).slice(0, 300));
