import { describe, it, expect } from "vitest";
import {
  emailSimilarity,
  levenshtein,
  maskEmail,
  maskPhone,
  normaliseEmail,
  normaliseIdNumber,
  normalisePhone,
} from "./identity";

describe("normalisePhone", () => {
  it("collapses every South African format to the same 9 digits", () => {
    for (const raw of [
      "082 123 4567",
      "+27 82 123 4567",
      "27821234567",
      "0027821234567",
      "0821234567",
    ]) {
      expect(normalisePhone(raw)).toBe("821234567");
    }
  });

  it("rejects junk and numbers that are too short", () => {
    expect(normalisePhone("")).toBe("");
    expect(normalisePhone(null)).toBe("");
    expect(normalisePhone("12345")).toBe("");
    expect(normalisePhone("abc")).toBe("");
  });
});

describe("normaliseIdNumber", () => {
  it("strips spaces and hyphens and uppercases", () => {
    expect(normaliseIdNumber("900101 5800 08A")).toBe("900101580008A");
    expect(normaliseIdNumber("900101-5800-08a")).toBe("900101580008A");
  });

  it("rejects very short values", () => {
    expect(normaliseIdNumber("12")).toBe("");
  });
});

describe("emailSimilarity", () => {
  it("scores exact and alias-equivalent addresses", () => {
    expect(emailSimilarity("a@x.co.za", "a@x.co.za")).toBe(90);
    expect(emailSimilarity("john.doe+driver@x.co.za", "johndoe@x.co.za")).toBe(85);
  });

  it("catches the known one-letter typo, including specials vs special", () => {
    expect(emailSimilarity("specials39u7@gmail.com", "special39u7@gmail.com")).toBe(70);
  });

  it("does not match a different domain or a wildly different local part", () => {
    expect(emailSimilarity("john@x.co.za", "john@y.co.za")).toBe(0);
    expect(emailSimilarity("john@x.co.za", "mary@x.co.za")).toBe(0);
  });
});

describe("levenshtein", () => {
  it("is zero for equal strings and one for one insertion", () => {
    expect(levenshtein("abc", "abc")).toBe(0);
    expect(levenshtein("abc", "abxc")).toBe(1);
    expect(levenshtein("", "abc")).toBe(3);
  });
});

describe("masking", () => {
  it("never returns the full address or number", () => {
    expect(maskEmail("specials39u7@gmail.com")).toBe("sp**********@gmail.com");
    expect(maskPhone("0821234567")).toBe("082 *** 4567");
  });
});

describe("normaliseEmail", () => {
  it("separates the alias key from the full address", () => {
    expect(normaliseEmail("John.Doe+driver@Gmail.com")).toMatchObject({
      full: "john.doe+driver@gmail.com",
      domain: "gmail.com",
      key: "johndoe",
    });
  });
});
