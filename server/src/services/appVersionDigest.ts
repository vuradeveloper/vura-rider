// ─────────────────────────────────────────────────────────────────────────────
// App update nudges.
//
// Play/App Store update at their own pace; drivers who installed an APK file
// never update at all. Ops needs a repeatable morning routine, not guesswork:
//
//   • 08:00 Johannesburg: one email to the ops inboxes listing every driver
//     still behind, with the Play link and a ready-to-send WhatsApp link.
//   • Admin → App versions: "Send digest now", and per driver "WhatsApp" /
//     "Email" so a single straggler can be reached in one tap.
//
// WhatsApp is the primary channel in South Africa ride-hailing: it needs no app
// update and the driver already uses it. Email is the fallback, and the Play
// link is the destination for both.
// ─────────────────────────────────────────────────────────────────────────────
import { query } from "../config/database";
import { sendResendEmail } from "./adminInvite";

export interface OutdatedDriver {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  status: string | null;
  version: string | null;
  platform: string | null;
  last_seen: string;
  device: string | null;
}

const LATEST_DRIVER = () => process.env.DRIVER_LATEST_VERSION || "1.8.18";
const PLAY_URL = () =>
  process.env.DRIVER_STORE_URL || "https://play.google.com/store/apps/details?id=app.vura.driver";
const TESTING_URL = () =>
  process.env.DRIVER_TESTING_URL || "https://play.google.com/apps/testing/app.vura.driver";

const DEFAULTS = "info@ridevura.com,ridevura@gmail.com";

export function digestRecipients(): string[] {
  return (process.env.APP_UPDATE_DIGEST_TO || DEFAULTS)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function olderThan(version: string | null, latest: string): boolean {
  if (!version || version === "unknown") return true;
  const a = version.split(".").map((n) => Number(n) || 0);
  const b = latest.split(".").map((n) => Number(n) || 0);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] || 0;
    const y = b[i] || 0;
    if (x !== y) return x < y;
  }
  return false;
}

/** "+27 82 123 4567" → "27821234567" for wa.me. */
export function whatsappNumber(phone: string | null): string | null {
  if (!phone) return null;
  let digits = String(phone).replace(/[^\d]/g, "");
  if (!digits) return null;
  if (digits.startsWith("0")) digits = "27" + digits.slice(1);
  if (digits.length < 10) return null;
  return digits;
}

export function whatsappMessage(name: string | null): string {
  return [
    `Hi ${name ? name.split(" ")[0] : "driver"},`,
    "",
    "Vura Driver has a new version. Please update the app on this phone so you get the latest fixes:",
    TESTING_URL(),
    "",
    "Tap the link, install the Play version, then open Vura Driver and log in as usual. Your documents and trips stay on your account.",
    "",
    "— Vura Ops",
  ].join("\n");
}

export function whatsappLink(driver: { name: string | null; phone: string | null }): string | null {
  const num = whatsappNumber(driver.phone);
  if (!num) return null;
  return `https://wa.me/${num}?text=${encodeURIComponent(whatsappMessage(driver.name))}`;
}

/** Live sessions in the last 30 days on an older build. */
export async function listOutdatedDrivers(): Promise<OutdatedDriver[]> {
  const rows = await query<any>(
    `SELECT u.id, u.full_name AS name, u.email, u.phone,
            dp.status,
            s.app_version AS version, s.platform,
            s.last_seen_at AS last_seen, s.device_name AS device
       FROM user_sessions s
       JOIN users u ON u.id = s.user_id
       LEFT JOIN driver_profiles dp ON dp.user_id = u.id
      WHERE u.role = 'driver'
        AND s.revoked_at IS NULL
        AND s.last_seen_at > NOW() - INTERVAL '30 days'
      ORDER BY s.last_seen_at DESC`
  ).catch(() => [] as any[]);

  const latest = LATEST_DRIVER();
  return rows
    .filter((r) => olderThan(r.version, latest))
    .map((r) => ({ ...r, last_seen: r.last_seen })) as OutdatedDriver[];
}

function shell(inner: string): string {
  return `<!doctype html><html><body style="margin:0;background:#F4F1EC;font-family:Arial,Helvetica,sans-serif;color:#0B0B0C">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:24px 0;background:#F4F1EC">
    <tr><td align="center">
      <table role="presentation" width="640" cellpadding="0" cellspacing="0" style="background:#fff;border:1px solid #E6E1DA">
        <tr><td style="background:#0B0B0C;padding:18px 24px">
          <span style="color:#fff;font-size:18px;font-weight:800">VURA</span>
          <span style="color:#E1251B;font-size:10px;font-weight:800;letter-spacing:.22em;margin-left:10px">OPS / APP UPDATE</span>
        </td></tr>
        <tr><td style="padding:22px 24px">${inner}</td></tr>
        <tr><td style="padding:12px 24px;background:#FAF8F5;border-top:1px solid #E6E1DA;color:#8A837D;font-size:10px">
          Automated 08:00 digest · recipients via APP_UPDATE_DIGEST_TO · link: ${PLAY_URL()}
        </td></tr>
      </table>
    </td></tr>
  </table></body></html>`;
}

function digestHtml(drivers: OutdatedDriver[]): string {
  const rows = drivers
    .map((d) => {
      const wa = whatsappLink(d);
      return `<tr>
        <td style="padding:8px 8px 8px 0;border-top:1px solid #F2F2F2">${escape(d.name || "Unnamed")}
          <div style="color:#8A837D;font-size:11px">${escape(d.email || d.phone || "no contact")}</div></td>
        <td style="padding:8px;border-top:1px solid #F2F2F2;color:#B26A00;font-weight:700">${escape(d.version || "unknown")}</td>
        <td style="padding:8px;border-top:1px solid #F2F2F2">${new Date(d.last_seen).toLocaleDateString("en-ZA")}</td>
        <td style="padding:8px 0 8px 8px;border-top:1px solid #F2F2F2">
          ${wa ? `<a href="${wa}" style="color:#C5221F;font-weight:700">WhatsApp</a>` : `<span style="color:#8A837D">no phone</span>`}
        </td>
      </tr>`;
    })
    .join("");

  return shell(`
    <p style="margin:0;font-size:10px;font-weight:800;letter-spacing:.18em;color:#C5221F">ACTION NEEDED</p>
    <h1 style="margin:6px 0 4px;font-size:22px">${drivers.length} driver(s) on an old build</h1>
    <p style="margin:0;color:#6B6560;font-size:13px">
      Current driver build: <b>${LATEST_DRIVER()}</b>. Send the link below to anyone on the list.
      Drivers installed from Play update themselves once the new version is published.
    </p>
    <p style="margin:16px 0">
      <a href="${TESTING_URL()}" style="display:inline-block;background:#E1251B;color:#fff;text-decoration:none;font-size:12px;font-weight:800;padding:12px 18px">DRIVER UPDATE LINK</a>
      <a href="${PLAY_URL()}" style="display:inline-block;margin-left:8px;color:#0B0B0C;font-size:12px;font-weight:700;padding:12px 0">Play listing</a>
    </p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:12px">
      <tr style="color:#8A837D;font-size:10px;text-transform:uppercase;letter-spacing:.12em">
        <th align="left" style="padding-bottom:6px">Driver</th>
        <th align="left" style="padding-bottom:6px">Version</th>
        <th align="left" style="padding-bottom:6px">Last seen</th>
        <th align="left" style="padding-bottom:6px">Reach</th>
      </tr>
      ${rows || `<tr><td colspan="4" style="padding:14px 0;color:#6B6560">Everyone is current. Nothing to send.</td></tr>`}
    </table>
    <p style="margin:16px 0 0;font-size:12px;color:#6B6560">
      Why WhatsApp first: it needs no app update, works on any phone, and the driver already uses it.
      The Play link is the destination. Never send the raw APK by WhatsApp — those installs never auto-update.
    </p>
  `);
}

export async function sendAppVersionDigest(): Promise<{ ok: boolean; drivers: number; to: string[]; error?: string }> {
  const drivers = await listOutdatedDrivers();
  const to = digestRecipients();
  const subject =
    drivers.length === 0
      ? "[Vura] All drivers are on the current build"
      : `[Vura] ${drivers.length} driver(s) still on an old build`;
  const res = await sendResendEmail({ to: to.join(","), subject, html: digestHtml(drivers) });
  return { ok: res.ok, drivers: drivers.length, to, error: res.error };
}

/** Email one driver their personal update link. */
export async function emailDriverUpdate(driver: OutdatedDriver): Promise<{ ok: boolean; error?: string }> {
  if (!driver.email) return { ok: false, error: "No email on file" };
  const wa = whatsappLink(driver);
  return sendResendEmail({
    to: driver.email,
    subject: "Update Vura Driver on your phone",
    html: shell(`
      <p style="margin:0;font-size:13px">Hi ${escape(driver.name?.split(" ")[0] || "driver")},</p>
      <p style="margin:10px 0;font-size:13px;line-height:1.6">
        Your phone is running Vura Driver <b>${escape(driver.version || "an old version")}</b>.
        The current build is <b>${LATEST_DRIVER()}</b>. Please update so you get the latest fixes.
      </p>
      <p style="margin:16px 0">
        <a href="${TESTING_URL()}" style="display:inline-block;background:#E1251B;color:#fff;text-decoration:none;font-size:12px;font-weight:800;padding:12px 18px">UPDATE VURA DRIVER</a>
      </p>
      ${wa ? `<p style="margin:0 0 12px"><a href="${wa}" style="color:#C5221F;font-weight:700;font-size:12px">Or send us a WhatsApp</a></p>` : ""}
      <p style="margin:0;font-size:12px;color:#6B6560">
        Tap the link, install the Play version, then open the app and log in as usual.
        Your documents, trips and payouts stay on your account.
      </p>
    `),
  });
}

/** 08:00 Africa/Johannesburg, once per day. Returns a stop function. */
export function startAppVersionDigestWorker(): () => void {
  if (String(process.env.APP_UPDATE_DIGEST || "on").toLowerCase() === "off") return () => undefined;
  let lastDay = "";

  const tick = async () => {
    try {
      // SAST is UTC+2 with no DST.
      const now = new Date(Date.now() + 2 * 60 * 60 * 1000);
      const hour = now.getUTCHours();
      const day = now.toISOString().slice(0, 10);
      if (hour !== 8 || lastDay === day) return;
      lastDay = day;
      const res = await sendAppVersionDigest();
      console.log(`[app-update] digest sent drivers=${res.drivers} ok=${res.ok}`);
    } catch (e: any) {
      console.warn("[app-update] digest failed:", e?.message || e);
    }
  };

  const timer = setInterval(() => void tick(), 15 * 60_000);
  void tick();
  return () => clearInterval(timer);
}

function escape(s: string): string {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
