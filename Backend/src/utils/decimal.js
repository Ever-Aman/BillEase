export function toNanos(value) {
  const [whole, fraction = ""] = String(value).split(".");
  return (
    BigInt(whole) * 1000000000n + BigInt(fraction.padEnd(9, "0").slice(0, 9))
  );
}
export function fromNanos(value) {
  return `${value / 1000000000n}.${String(value % 1000000000n).padStart(9, "0")}`;
}
export const min = (a, b) => (a < b ? a : b);
export const max = (a, b) => (a > b ? a : b);
export const ceilDivide = (a, b) => (a + b - 1n) / b;
