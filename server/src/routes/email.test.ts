import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";

const db = vi.hoisted(() => ({
  queryOne: vi.fn(async () => null),
  execute: vi.fn(async () => ({ rowCount: 1, rows: [] })),
}));
vi.mock("../config/database", () => db);

import emailRouter from "./email";
import { emailUnsubToken } from "../services/emailCampaigns";

let server: any;
let base = "";

beforeEach(async () => {
  db.queryOne.mockReset();
  db.execute.mockClear();
  const app = express();
  app.use("/api/email", emailRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  base = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
});

afterEach(() => server?.close());

describe("email unsubscribe", () => {
  it("opts the user out with a valid signed link", async () => {
    const user = "11111111-1111-4111-8111-111111111111";
    const res = await fetch(
      `${base}/api/email/unsubscribe?u=${user}&t=${emailUnsubToken(user)}`
    );
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("You’re unsubscribed");
    expect(db.execute).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE users SET email_opt_out = TRUE"),
      [user]
    );
  });

  it("rejects a forged link without touching the account", async () => {
    const user = "11111111-1111-4111-8111-111111111111";
    const res = await fetch(`${base}/api/email/unsubscribe?u=${user}&t=bad`);
    expect(res.status).toBe(400);
    expect(db.execute).not.toHaveBeenCalledWith(
      expect.stringContaining("email_opt_out = TRUE"),
      expect.anything()
    );
  });
});

describe("email hero", () => {
  it("renders a branded PNG without any stored file", async () => {
    const res = await fetch(`${base}/api/email/hero/generic.png`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("image/png");
    const buf = Buffer.from(await res.arrayBuffer());
    expect(buf.length).toBeGreaterThan(10_000);
    expect(buf.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  });
});
