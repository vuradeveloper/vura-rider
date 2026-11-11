"use strict";
/**
 * Branded marketing email for admin broadcasts and promo announcements.
 *
 * Deliberately table-based with inline styles: Gmail, Outlook and Apple Mail
 * strip <style> blocks and flex/grid, so a modern-looking React/CSS email
 * collapses in the inbox. The images are served from our own API (logo and a
 * generated hero), so the design works without third-party tracking pixels.
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
<body style="margin:0;padding:0;background:#F3F1EE;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">
    ${esc(input.heading)}${discount ? ` · ${esc(discount)}` : ""}${code ? ` · code ${esc(code)}` : ""}
  </div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#F3F1EE;padding:28px 12px">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:620px;width:100%">
          <tr>
            <td style="padding:0 0 14px 4px">
              <img src="${esc(logo)}" alt="Vura" width="118" style="display:block;width:118px;height:auto;border:0">
            </td>
          </tr>
          <tr>
            <td style="background:#FFFFFF;border-radius:24px;overflow:hidden;box-shadow:0 12px 40px rgba(20,20,20,0.10)">
              <img src="${esc(hero)}" alt="" width="620" style="display:block;width:100%;max-width:620px;height:auto;border:0">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="padding:30px 34px 8px">
                    <span style="display:inline-block;background:#FEF0EF;color:#C5221F;font:700 11px/1 Arial,Helvetica,sans-serif;letter-spacing:1.4px;text-transform:uppercase;padding:9px 12px;border-radius:999px">
                      ${code ? "Vura promo" : "Vura news"}
                    </span>
                    <h1 style="margin:18px 0 0;color:#141414;font:800 32px/1.15 Arial,Helvetica,sans-serif;letter-spacing:-0.5px">
                      ${esc(input.heading)}
                    </h1>
                    <p style="margin:14px 0 0;color:#4A4A4A;font:400 16px/1.6 Arial,Helvetica,sans-serif">
                      ${greeting}
                    </p>
                    <p style="margin:8px 0 0;color:#4A4A4A;font:400 16px/1.6 Arial,Helvetica,sans-serif">
                      ${esc(input.body)}
                    </p>
                    ${discount
        ? `<p style="margin:18px 0 0;color:#EA4335;font:800 22px/1.3 Arial,Helvetica,sans-serif">${esc(discount)}</p>`
        : ""}
                  </td>
                </tr>
                ${code
        ? `<tr>
                  <td style="padding:18px 34px 0">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#FFF7F0;border:2px dashed #EA4335;border-radius:16px">
                      <tr>
                        <td align="center" style="padding:18px 12px">
                          <div style="color:#8A5A00;font:700 10px/1 Arial,Helvetica,sans-serif;letter-spacing:1.6px;text-transform:uppercase;margin-bottom:8px">
                            Your code
                          </div>
                          <div style="color:#141414;font:800 30px/1.1 'Courier New',Courier,monospace;letter-spacing:3px">
                            ${esc(code)}
                          </div>
                          <div style="color:#8A5A00;font:400 12px/1.5 Arial,Helvetica,sans-serif;margin-top:8px">
                            Enter it at checkout in the Vura app
                          </div>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>`
        : ""}
                <tr>
                  <td style="padding:24px 34px 6px">
                    <a href="${esc(ctaUrl)}" style="display:inline-block;background:#EA4335;color:#FFFFFF;text-decoration:none;font:700 16px/1 Arial,Helvetica,sans-serif;padding:16px 26px;border-radius:14px">
                      ${esc(ctaLabel)} &rarr;
                    </a>
                  </td>
                </tr>
                <tr>
                  <td style="padding:16px 34px 0">
                    <p style="margin:0;color:#8A8A8A;font:400 12px/1.7 Arial,Helvetica,sans-serif">
                      ${esc(audienceText(input.audienceLabel))}${expiry ? ` · Valid until ${esc(expiry)}` : ""}
                    </p>
                  </td>
                </tr>
                <tr>
                  <td style="padding:24px 34px 30px">
                    <div style="height:1px;background:#F0EDE9;margin:0 0 18px"></div>
                    <p style="margin:0;color:#8A8A8A;font:400 12px/1.7 Arial,Helvetica,sans-serif">
                      You received this because you have a Vura account.
                      ${input.promoCode ? "Promo codes are subject to availability and cannot be exchanged for cash." : ""}
                    </p>
                    <p style="margin:8px 0 0;color:#8A8A8A;font:400 12px/1.7 Arial,Helvetica,sans-serif">
                      Need help? Email
                      <a href="mailto:support@ridevura.com" style="color:#EA4335;text-decoration:none">support@ridevura.com</a>.
                    </p>
                    <p style="margin:12px 0 0;color:#ADADAD;font:400 11px/1.7 Arial,Helvetica,sans-serif">
                      <a href="${esc(input.unsubscribeUrl)}" style="color:#ADADAD;text-decoration:underline">Unsubscribe from Vura emails</a>
                      · Vura, South Africa
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:16px 8px 0;color:#ADADAD;font:400 11px/1.6 Arial,Helvetica,sans-serif">
              Vura · Ride more, pay less.
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