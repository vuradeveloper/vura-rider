// Split fare arithmetic — the money rules that must never drift.
//   • every co-rider pays the same rounded share;
//   • the booking rider's capture is the remainder, never negative;
//   • the rider count is exactly 2–4.
// The DB/charge flows are exercised by the manual live test; these pin the
// numbers that those flows depend on.
import { describe, expect, it } from "vitest";
import {
  isValidShareCount,
  primaryRemainderRands,
  splitShareRands,
} from "./splitFareService";

describe("splitShareRands", () => {
  it("splits a fare equally and rounds to cents", () => {
    expect(splitShareRands(100, 4)).toBe(25);
    expect(splitShareRands(100, 3)).toBe(33.33);
    expect(splitShareRands(47.5, 2)).toBe(23.75);
  });

  it("never returns a negative or NaN share for bad input", () => {
    expect(splitShareRands(0, 4)).toBe(0);
    expect(splitShareRands(-20, 2)).toBe(0);
    expect(splitShareRands(Number.NaN, 2)).toBe(0);
    expect(splitShareRands(100, 0)).toBe(0);
  });
});

describe("primaryRemainderRands", () => {
  it("is the booking rider's own share when every co-rider paid", () => {
    expect(primaryRemainderRands(100, 75)).toBe(25);
    expect(primaryRemainderRands(100, 66.66)).toBe(33.34);
    expect(primaryRemainderRands(47.5, 23.75)).toBe(23.75);
  });

  it("clamps at zero — the hold can never be over-captured", () => {
    expect(primaryRemainderRands(100, 100)).toBe(0);
    expect(primaryRemainderRands(100, 120)).toBe(0);
  });

  it("is unchanged for a one-person ride (no shares paid)", () => {
    expect(primaryRemainderRands(87.4, 0)).toBe(87.4);
  });
});

describe("isValidShareCount", () => {
  it("accepts exactly 2–4 riders", () => {
    expect(isValidShareCount(2)).toBe(true);
    expect(isValidShareCount(3)).toBe(true);
    expect(isValidShareCount(4)).toBe(true);
  });

  it("rejects everything else", () => {
    for (const value of [0, 1, 5, 10, -1, "2.5", null, undefined, Number.NaN]) {
      expect(isValidShareCount(value)).toBe(false);
    }
  });
});
