// Promo diagnostic: what does GET /api/promos/active?side=rider actually
// return for a real rider right now? Read-only.
// Usage: node _promo_active_probe.mjs [riderEmail] [riderPassword]
const API = 'https://api.ridevura.com';
const FIREBASE_KEY = 'AIzaSyC3lSrWd0JHWS8FzyaW9h8GgQyzNK3sC3Q';
const EMAIL = process.argv[2] || 'specials39u7@gmail.com';
const PASS = process.argv[3] || 'Makhavhu@77';

const signIn = async (email, password) => {
  const r = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${FIREBASE_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
    }
  );
  const j = await r.json();
  if (!j.idToken) throw new Error('signin: ' + JSON.stringify(j).slice(0, 300));
  return j.idToken;
};

const token = await signIn(EMAIL, PASS);
console.log('signed in as', EMAIL);
console.log('now (SAST):', new Date().toLocaleString('en-ZA', { timeZone: 'Africa/Johannesburg' }));

const r = await fetch(`${API}/api/promos/active?side=rider`, {
  headers: { Authorization: `Bearer ${token}` },
});
const t = await r.text();
console.log('GET /api/promos/active?side=rider -> HTTP', r.status);
console.log(t.slice(0, 2000));
