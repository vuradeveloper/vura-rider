import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  query: vi.fn(async () => [] as any[]),
  queryOne: vi.fn(),
  execute: vi.fn(async () => ({ rowCount: 1, rows: [] })),
}));
vi.mock("../config/database", () => db);
vi.mock("./adminInvite", () => ({
  sendResendEmail: vi.fn(async () => ({ ok: true })),
}));

import { createEmailCampaign, queuePromoEmail } from "./emailCampaigns";

beforeEach(() => {
  db.query.mockReset();
  db.query.mockResolvedValue([]);
  db.queryOne.mockReset();
  db.execute.mockClear();
});

const promo = {
  id: "11111111-1111-4111-8111-111111111111",
  code: "WINTER20",
  title: "20% off your next ride",
  subtitle: "The cold never bothered you anyway.",
  audience: "both",
  discount_pct: "20",
  discount_fixed: "0",
  active: true,
  starts_at: null,
  ends_at: "2026-12-31T23:59:59Z",
  target_user_ids: null,
};

describe("createEmailCampaign", () => {
  it("assigns the generated hero image when the admin leaves it blank", async () => {
    db.queryOne.mockResolvedValueOnce({
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      name: "Winter",
      subject: "20% off",
      heading: "20% off",
      body: "Use it",
      audience: "riders",
      image_url: null,
    });
    const row = await createEmailCampaign({
      name: "Winter",
      subject: "20% off",
      heading: "20% off",
      body: "Use it",
      audience: "riders",
    });
    expect(row.image_url).toContain("/api/email/hero/");
    expect(db.execute).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE email_campaigns SET image_url"),
      [row.id, expect.stringContaining("/api/email/hero/")]
    );
  });
});

describe("queuePromoEmail", () => {
  it("maps a both-audience promo to all and queues the announcement once", async () => {
    db.queryOne.mockImplementation(async (sql: string) => {
      if (sql.includes("UPDATE admin_promos")) return promo;
      if (sql.includes("INSERT INTO email_campaigns")) {
        return {
          id: "campaign-1",
          name: "Promo WINTER20",
          subject: "20% off your next ride — 20% off",
          heading: promo.title,
          body: promo.subtitle,
          audience: "all",
          kind: "promo",
          promo_code: "WINTER20",
          discount_label: "20% off",
          image_url: "https://api.ridevura.com/api/email/hero/campaign-1.png",
        };
      }
      if (sql.includes("UPDATE email_campaigns")) return { id: "campaign-1", status: "queued" };
      return null;
    });

    const out = await queuePromoEmail(promo, "ops@vura.test");
    expect(out?.id).toBe("campaign-1");
    const insert = db.queryOne.mock.calls.find(([sql]) => String(sql).includes("INSERT INTO email_campaigns"));
    expect(insert?.[1]).toEqual(
      expect.arrayContaining(["20% off your next ride — 20% off", "all", "WINTER20", "20% off"])
    );
  });

  it("does not announce an inactive promo", async () => {
    const out = await queuePromoEmail({ ...promo, active: false }, "ops@vura.test");
    expect(out).toBeNull();
    expect(db.queryOne).not.toHaveBeenCalled();
  });

  it("does not send twice when email_sent_at was already claimed", async () => {
    db.queryOne.mockResolvedValueOnce(null); // atomic UPDATE ... WHERE email_sent_at IS NULL
    const out = await queuePromoEmail(promo, "ops@vura.test");
    expect(out).toBeNull();
    expect(
      db.queryOne.mock.calls.some(([sql]) => String(sql).includes("INSERT INTO email_campaigns"))
    ).toBe(false);
  });
});
