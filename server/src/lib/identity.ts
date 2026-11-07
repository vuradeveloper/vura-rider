// identity - normalisation and similarity for duplicate-account detection.
//
// Pure functions only: no database, no Express, no Firebase. Keeping them here
// means the rules are unit-testable and the service layer just does the SQL.
//
// South African phone numbers arrive in every shape: 082 123 4567, +27 82 123
// 4567, 0027821234567, 27821234567. They all normalise to the same 9 digits.
// IDs are 13 digits; emails are compared with dots/plus aliases removed so
// john.doe+driver@gmail.com matches johndoe@gmail.com.

export function normalisePhone(raw: unknown): string {
  const digits = String(raw ?? "").replace(/\D/g, "");
  if (!digits) return "";
  let d = digits;
  if (d.startsWith("0027")) d = d.slice(4);
  else if (d.startsWith("27") && d.length >= 11) d = d.slice(2);
  if (d.startsWith("0")) d = d.slice(1);
  // A usable South African number is 9 digits after the country/trunk prefix.
  // Taking the last 9 also handles a number stored with extra leading digits.
  return d.length >= 9 ? d.slice(-9) : "";
}

export function normaliseIdNumber(raw: unknown): string {
  const s = String(raw ?? "").replace(/[^0-9A-Za-z]/g, "").toUpperCase();
  return s.length >= 6 ? s : "";
}

export function normaliseEmail(raw: unknown): {
  full: string;
  local: string;
  domain: string;
  key: string;
} {
  const full = String(raw ?? "").trim().toLowerCase();
  const at = full.lastIndexOf("@");
  if (at <= 0 || at === full.length - 1) {
    return { full, local: full, domain: "", key: full };
  }
  const local = full.slice(0, at);
  const domain = full.slice(at + 1);
  // Gmail-style aliases: dots are ignored and +tag is a routing label.
  const key = local.split("+")[0].replace(/\./g, "");
  return { full, local, domain, key };
}

/** Classic Levenshtein distance, capped for short strings. */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = new Array(b.length + 1);
  let cur = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(cur[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    [prev, cur] = [cur, prev];
  }
  return prev[b.length];
}

/**
 * 90 exact address, 85 alias-equivalent, 70 one-character typo in the local
 * part, 0 otherwise. Domain must match for every level below exact.
 */
export function emailSimilarity(a: unknown, b: unknown): number {
  const x = normaliseEmail(a);
  const y = normaliseEmail(b);
  if (!x.full || !y.full) return 0;
  if (x.full === y.full) return 90;
  if (!x.domain || x.domain !== y.domain) return 0;
  if (x.key === y.key) return 85;
  if (Math.min(x.key.length, y.key.length) < 6) return 0;
  if (levenshtein(x.key, y.key) <= 1) return 70;
  return 0;
}

/** Never expose a full address in a signup response or an admin list. */
export function maskEmail(raw: unknown): string {
  const e = normaliseEmail(raw);
  if (!e.full) return "";
  const at = e.full.lastIndexOf("@");
  if (at <= 0) return e.full;
  const local = e.full.slice(0, at);
  const domain = e.full.slice(at + 1);
  const head = local.slice(0, Math.min(2, local.length));
  return `${head}${"*".repeat(Math.max(3, local.length - head.length))}@${domain}`;
}

/** A phone shown to an admin or in a signup conflict: 082 *** 4567. */
export function maskPhone(raw: unknown): string {
  const p = normalisePhone(raw);
  if (!p) return "";
  return `0${p.slice(0, 2)} *** ${p.slice(-4)}`;
}
