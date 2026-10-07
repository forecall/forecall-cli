/**
 * Rounds like Python's built-in `round(value, digits)`: half to even, decided on the exact binary
 * value of the double. `round(2.675, 2)` is 2.67 because 2.675 is stored as 2.67499999...
 * The static linter needs this to match the Python prototype exactly.
 */
export function roundHalfEven(value: number, digits = 0): number {
  if (!Number.isFinite(value)) throw new RangeError(`value must be finite: ${value}`);
  if (!Number.isInteger(digits) || digits < 0) {
    throw new RangeError(`digits must be a non-negative integer: ${digits}`);
  }
  if (Number.isInteger(value)) return value;

  // value = mantissa * 2^exponent exactly, with exponent < 0 because value is not an integer.
  const { mantissa, exponent } = decompose(Math.abs(value));
  const numerator = mantissa * 10n ** BigInt(digits);
  const denominator = 1n << BigInt(-exponent);
  let quotient = numerator / denominator;
  const twiceRemainder = 2n * (numerator - quotient * denominator);
  if (twiceRemainder > denominator || (twiceRemainder === denominator && quotient % 2n === 1n)) {
    quotient += 1n;
  }

  // Like Python, turn the exact decimal back into the nearest double through its string form.
  const text = quotient.toString().padStart(digits + 1, "0");
  const decimal = digits === 0 ? text : `${text.slice(0, -digits)}.${text.slice(-digits)}`;
  return value < 0 ? -Number(decimal) : Number(decimal);
}

function decompose(value: number): { mantissa: bigint; exponent: number } {
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, value);
  const bits = view.getBigUint64(0);
  const biasedExponent = Number(bits >> 52n);
  const fraction = bits & 0xf_ffff_ffff_ffffn;
  return biasedExponent === 0
    ? { mantissa: fraction, exponent: -1074 }
    : { mantissa: fraction | (1n << 52n), exponent: biasedExponent - 1075 };
}
