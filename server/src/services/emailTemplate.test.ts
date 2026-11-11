import { describe, expect, it } from "vitest";
import { renderMarketingEmail } from "./emailTemplate";

const base = {
  heading: "20% off your next ride",
  body: "Use your code before Sunday.",
  subject: "20% off this week",
  audienceLabel: "riders",
  promoCode: "WINTER20",
  discountLabel: "20% off",
  expiresAt: "2026-12-31T23:59:59Z",
  heroUrl: "https://api.ridevura.com/api/email/hero/abc.png",
  ctaLabel: "Book a ride",
  ctaUrl: "https://www.ridevura.com",
  unsubscribeUrl: "https://api.ridevura.com/api/email/unsubscribe?u=1&t=abc",
  recipientName: "Thabo Rider",
};

describe("renderMarketingEmail", () => {
  it("renders a branded email with the logo, hero, code and unsubscribe link", () => {
    const html = renderMarketingEmail(base);
    expect(html).toContain("https://api.ridevura.com/api/share/logo.png");
    expect(html).toContain("https://api.ridevura.com/api/email/hero/abc.png");
    expect(html).toContain("WINTER20");
    expect(html).toContain("20% off");
    expect(html).toContain("Hi Thabo,");
    expect(html).toContain("Book a ride");
    expect(html).toContain("Unsubscribe from Vura emails");
    expect(html).toContain("Valid until");
    expect(html).toContain("For Vura riders");
    // table-based layout, not a bare <p> dump
    expect(html).toContain('role="presentation"');
  });

  it("escapes admin-supplied text", () => {
    const html = renderMarketingEmail({
      ...base,
      heading: "<script>alert(1)</script>",
      body: '<img src=x onerror="alert(1)">',
      promoCode: "A<B",
      recipientName: "<b>Thabo</b>",
    });
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("A&lt;B");
  });

  it("falls back to the Vura site and generic hero when the admin leaves links blank", () => {
    const html = renderMarketingEmail({
      ...base,
      heroUrl: null,
      ctaUrl: "javascript:alert(1)",
      ctaLabel: null,
    });
    expect(html).toContain("/api/email/hero/generic.png");
    expect(html).toContain("https://www.ridevura.com");
    expect(html).not.toContain("javascript:alert");
  });
});
