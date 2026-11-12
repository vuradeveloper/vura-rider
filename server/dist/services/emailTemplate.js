"use strict";
/**
 * Branded marketing email for admin broadcasts and promo announcements.
 *
 * Deliberately table-based with inline styles: Gmail, Outlook and Apple Mail
 * strip <style> blocks and flex/grid, so a modern-looking React/CSS email
 * collapses in the inbox. The images are served from our own API (logo and a
 * generated hero), so the design works without third-party tracking pixels.
 *
 * Design: Vura white / red / black. Sharp edges, one accent, no rounded card
 * or pill chrome — the same editorial treatment as the website.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.emailPublicBase = emailPublicBase;
exports.unsubscribeUrl = unsubscribeUrl;
exports.renderMarketingEmail = renderMarketingEmail;
function esc(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}
function emailPublicBase() {
    return (process.env.PUBLIC_BASE_URL || "https://api.ridevura.com").replace(/\/+$/, "");
}
function unsubscribeUrl(userId, token) {
    return `${emailPublicBase()}/api/email/unsubscribe?u=${encodeURIComponent(userId)}&t=${encodeURIComponent(token)}`;
}
function audienceText(label) {
    if (label === "drivers")
        return "For Vura drivers";
    if (label === "riders")
        return "For Vura riders";
    return "For the Vura community";
}
function validDate(value) {
    if (!value)
        return null;
    const d = new Date(value);
    if (Number.isNaN(d.getTime()))
        return null;
    return d.toLocaleDateString("en-ZA", { day: "numeric", month: "long", year: "numeric" });
}
function renderMarketingEmail(input) {
    const base = emailPublicBase();
    const logo = `${base}/api/share/logo.png`;
    const hero = input.heroUrl && /^https?:\/\//i.test(input.heroUrl)
        ? input.heroUrl
        : `${base}/api/email/hero/generic.png`;
    const ctaUrl = input.ctaUrl && /^https?:\/\//i.test(input.ctaUrl) ? input.ctaUrl : "https://www.ridevura.com";
    const ctaLabel = (input.ctaLabel || "Open Vura").slice(0, 40);
    const code = String(input.promoCode || "").trim();
    const discount = String(input.discountLabel || "").trim();
    const expiry = validDate(input.expiresAt);
    const firstName = String(input.recipientName || "").trim().split(/\s+/)[0];
    const greeting = firstName ? `Hi ${esc(firstName)},` : "Hi there,";
    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="light">
  <title>${esc(input.subject)}</title>
</head>
<body style="margin:0;padding:0;background:#EDEAE4;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">
    ${esc(input.heading)}${discount ? ` — ${esc(discount)}` : ""}${code ? ` — code ${esc(code)}` : ""}
  </div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#EDEAE4;padding:32px 12px">
    <tr>
      <td align="center">

        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:620px;width:100%">

          <!-- red top rule -->
          <tr>
            <td style="height:4px;background:#E1251B;font-size:0;line-height:0">&nbsp;</td>
          </tr>

          <!-- wordmark -->
          <tr>
            <td style="background:#FFFFFF;border:1px solid #E6E1DA;border-bottom:0;padding:20px 24px">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td align="left" style="vertical-align:middle">
                    <img src="${esc(logo)}" alt="Vura" width="104" style="display:block;width:104px;height:auto;border:0">
                  </td>
                  <td align="right" style="vertical-align:middle;color:#8A837D;font:700 8px/1.5 Arial,Helvetica,sans-serif;letter-spacing:1.8px;text-transform:uppercase">
                    Johannesburg<br>South Africa
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- hero image, no radius -->
          <tr>
            <td style="background:#FFFFFF;border-left:1px solid #E6E1DA;border-right:1px solid #E6E1DA;font-size:0;line-height:0">
              <img src="${esc(hero)}" alt="" width="620" style="display:block;width:100%;max-width:620px;height:auto;border:0">
            </td>
          </tr>

          <!-- content -->
          <tr>
            <td style="background:#FFFFFF;border:1px solid #E6E1DA;border-top:0">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">

                <tr>
                  <td style="padding:30px 34px 0">
                    <p style="margin:0;color:#E1251B;font:700 10px/1 Arial,Helvetica,sans-serif;letter-spacing:2px;text-transform:uppercase">
                      ${code ? "Vura promo" : "Vura news"} &nbsp;·&nbsp; ${esc(audienceText(input.audienceLabel))}
                    </p>
                    <h1 style="margin:16px 0 0;color:#0B0B0C;font:800 34px/1.08 Arial,Helvetica,sans-serif;letter-spacing:-0.6px">
                      ${esc(input.heading)}
                    </h1>
                    <p style="margin:18px 0 0;color:#4A4A4A;font:400 15px/1.7 Arial,Helvetica,sans-serif">
                      ${greeting}
                    </p>
                    <p style="margin:6px 0 0;color:#4A4A4A;font:400 15px/1.7 Arial,Helvetica,sans-serif">
                      ${esc(input.body)}
                    </p>
                    ${discount
        ? `<p style="margin:16px 0 0;color:#E1251B;font:800 20px/1.3 Arial,Helvetica,sans-serif">${esc(discount)}</p>`
        : ""}
                  </td>
                </tr>

                ${code
        ? `<tr>
                  <td style="padding:20px 34px 0">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #E1251B;background:#FFFFFF">
                      <tr>
                        <td align="center" style="padding:20px 14px">
                          <p style="margin:0;color:#E1251B;font:700 9px/1 Arial,Helvetica,sans-serif;letter-spacing:2px;text-transform:uppercase">Your code</p>
                          <p style="margin:9px 0 0;color:#0B0B0C;font:800 30px/1.1 'Courier New',Courier,monospace;letter-spacing:4px">${esc(code)}</p>
                          <p style="margin:9px 0 0;color:#6B6560;font:400 11px/1.5 Arial,Helvetica,sans-serif">Enter it at checkout in the Vura app</p>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>`
        : ""}

                <tr>
                  <td style="padding:24px 34px 0">
                    <a href="${esc(ctaUrl)}" style="display:inline-block;background:#E1251B;color:#FFFFFF;text-decoration:none;font:700 11px/1 Arial,Helvetica,sans-serif;letter-spacing:1.5px;text-transform:uppercase;padding:16px 26px;border:1px solid #E1251B">
                      ${esc(ctaLabel)} &rarr;
                    </a>
                  </td>
                </tr>

                <tr>
                  <td style="padding:18px 34px 0">
                    <p style="margin:0;color:#8A837D;font:400 11px/1.7 Arial,Helvetica,sans-serif">
                      ${esc(audienceText(input.audienceLabel))}${expiry ? ` &nbsp;·&nbsp; Valid until ${esc(expiry)}` : ""}
                    </p>
                  </td>
                </tr>

                <tr>
                  <td style="padding:24px 34px 30px">
                    <div style="height:1px;background:#E6E1DA;margin:0 0 18px"></div>
                    <p style="margin:0;color:#8A837D;font:400 11px/1.7 Arial,Helvetica,sans-serif">
                      You received this because you have a Vura account.
                      ${input.promoCode ? "Promo codes are subject to availability and cannot be exchanged for cash." : ""}
                    </p>
                    <p style="margin:7px 0 0;color:#8A837D;font:400 11px/1.7 Arial,Helvetica,sans-serif">
                      Need help? Email
                      <a href="mailto:support@ridevura.com" style="color:#E1251B;text-decoration:none">support@ridevura.com</a>.
                    </p>
                    <p style="margin:12px 0 0;color:#A7A29C;font:400 10px/1.7 Arial,Helvetica,sans-serif">
                      <a href="${esc(input.unsubscribeUrl)}" style="color:#A7A29C;text-decoration:underline">Unsubscribe from Vura emails</a>
                      &nbsp;·&nbsp; Vura, South Africa
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- black footer -->
          <tr>
            <td style="background:#0B0B0C;padding:20px 24px;text-align:center">
              <p style="margin:0;color:#FFFFFF;font:800 13px/1 Arial,Helvetica,sans-serif;letter-spacing:3px;text-transform:uppercase">VURA</p>
              <p style="margin:7px 0 0;color:#A7A29C;font:400 10px/1.6 Arial,Helvetica,sans-serif">Ride the night. Johannesburg, South Africa.</p>
              <p style="margin:5px 0 0;color:#6B6560;font:400 9px/1.6 Arial,Helvetica,sans-serif">Dorfnew (Pty) Ltd</p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
//# sourceMappingURL=emailTemplate.js.map