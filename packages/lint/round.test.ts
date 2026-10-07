import { describe, expect, it } from "vitest";
import { roundHalfEven } from "./round.ts";

// Expected values come from CPython 3.13 `round(value, digits)`.
const cases: [value: number, digits: number, expected: number][] = [
  // Exact ties go to the even neighbour.
  [0.5, 0, 0],
  [1.5, 0, 2],
  [2.5, 0, 2],
  [3.5, 0, 4],
  [7.5, 0, 8],
  [-0.5, 0, -0],
  [-2.5, 0, -2],
  [0.125, 2, 0.12],
  [0.375, 2, 0.38],
  [-1.25, 1, -1.2],
  // Just below a tie in binary rounds down, just above rounds up.
  [2.4999999999999996, 0, 2],
  [0.49999999999999994, 0, 0],
  [2.675, 2, 2.67],
  [1.005, 2, 1],
  [62.35, 1, 62.4],
  [62.45, 1, 62.5],
  [5e-7, 6, 0],
  [2.5e-7, 7, 2e-7],
  // Ordinary values.
  [0.1 + 0.2, 1, 0.3],
  [1 / 3, 2, 0.33],
  [-0.4, 0, -0],
  [1e-7, 3, 0],
  // Subnormal input, and more digits than the double carries.
  [5e-324, 2, 0],
  [123456.789, 12, 123456.789],
  [1.5, 20, 1.5],
  // Integers come back unchanged.
  [0, 2, 0],
  [-0, 0, -0],
  [42, 0, 42],
  [2 ** 60, 3, 2 ** 60],
];

describe("roundHalfEven", () => {
  it.each(cases)("round(%s, %s) is %s", (value, digits, expected) => {
    expect(roundHalfEven(value, digits)).toBe(expected);
  });

  it("rounds to an integer by default", () => {
    expect(roundHalfEven(4.5)).toBe(4);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    "rejects the non-finite value %s",
    (value) => {
      expect(() => roundHalfEven(value)).toThrow(RangeError);
    },
  );

  it.each([-1, 1.5, Number.NaN])("rejects digits %s", (digits) => {
    expect(() => roundHalfEven(1.25, digits)).toThrow(RangeError);
  });
});
