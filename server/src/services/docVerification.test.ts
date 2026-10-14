import { describe, expect, it } from "vitest";

// Pure logic from the ridevura-verification port (server/verification — plain
// CJS at the same relative depth as docVerification.ts). No DB, no network.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { parseSaId, luhnValid } = require("../../verification/lib/saId");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { analyze } = require("../../verification/analyzers");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { finalize, computeIssues } = require("../../verification/lib/decide");

/** Builds a genuinely valid SA ID (correct Luhn check digit) for tests. */
function validSaId(): string {
  const base = "900101580000"; // 1990-01-01, male sequence, citizen digit 0, filler 0
  for (let d = 0; d <= 9; d++) if (luhnValid(base + String(d))) return base + String(d);
  throw new Error("no check digit found");
}

describe("doc verification (ridevura-verification port)", () => {
  it("validates SA ID numbers (date, citizenship, Luhn)", () => {
    const id = validSaId();
    const info = parseSaId(id);
    expect(info.valid).toBe(true);
    expect(info.dateOfBirth).toBe("1990-01-01");
    expect(info.gender).toBe("male");
    expect(info.citizen).toBe(true);

    const tampered = id.slice(0, 12) + String((Number(id[12]) + 1) % 10);
    expect(parseSaId(tampered).valid).toBe(false);
    expect(parseSaId("12345").valid).toBe(false);
  });

  it("ID document analyzer: valid ID + markers → pass; garbage → rejected", () => {
    const good = analyze("id_document", {
      text: `REPUBLIC OF SOUTH AFRICA\nIDENTITY NUMBER ${validSaId()}\nSURNAME TESTER`,
      profileName: null,
    });
    expect(good.status).toBe("approved");
    expect(good.extracted.idNumber).toBe(validSaId());

    const bad = analyze("id_document", { text: "grocery list, milk and bread", profileName: null });
    expect(bad.status).toBe("rejected");
  });

  it("a pass is NEVER auto-approved — finalize forces staff review", () => {
    const fin = finalize("id_document", { autoStatus: "approved", autoReasons: [] }, []);
    expect(fin.status).toBe("needs_review");
    expect(fin.reasons.join(" ")).toMatch(/staff approval/i);
  });

  it("license disk: VIN + future expiry pass; expired → rejected", () => {
    const ok = analyze("license_disk", {
      text: "LICENCE DISC\nVIN WAZZZPFJZLN012345\nDATE OF EXPIRY 2030/02/28",
      profileName: null,
    });
    expect(ok.status).toBe("approved");
    expect(ok.extracted.vin).toBe("WAZZZPFJZLN012345");

    const expired = analyze("license_disk", {
      text: "LICENCE DISC\nVIN WAZZZPFJZLN012345\nDATE OF EXPIRY 2020/02/28",
      profileName: null,
    });
    expect(expired.status).toBe("rejected");
    expect(expired.reasons.join(" ")).toMatch(/expired/i);
  });

  it("cross-doc: ID numbers on the licence must match the ID Document", () => {
    const id = validSaId();
    const docs = {
      id_document: { autoStatus: "approved", autoReasons: [], extracted: { idNumber: id }, status: "pending_review" },
      drivers_license: {
        autoStatus: "approved",
        autoReasons: [],
        extracted: { idNumbers: ["9999999999999"] },
        status: "pending_review",
      },
    };
    const issues = computeIssues(docs, null);
    expect(issues.drivers_license).toHaveLength(1);
    expect(issues.drivers_license[0].status).toBe("rejected");
    expect(issues.drivers_license[0].msg).toMatch(/doesn't match/i);
  });
});
