/**
 * Fixed-point decimal helpers. Every asset amount that crosses a boundary (ClickHouse
 * Decimal(38,18), Privy base units, the ledger) is carried as a decimal *string* and compared
 * as a bigint scaled to 18 decimal places. No floats are used for money.
 */
export const SCALE_DP = 18;
export const SCALE = 10n ** BigInt(SCALE_DP);

/** Parse a decimal string ("12", "-0.5", "1.000000000000000001") into an 18-dp scaled bigint. */
export function parseDecimal(input: string | number | null | undefined): bigint {
  if (input === null || input === undefined) return 0n;
  const s = String(input).trim();
  if (s === '' || s === 'null') return 0n;
  const m = /^(-?)(\d*)(?:\.(\d*))?$/.exec(s);
  if (!m) throw new Error(`not a decimal string: ${JSON.stringify(s)}`);
  const sign = m[1] === '-' ? -1n : 1n;
  const whole = m[2] === undefined || m[2] === '' ? '0' : m[2];
  const frac = (m[3] ?? '').padEnd(SCALE_DP, '0').slice(0, SCALE_DP);
  return sign * (BigInt(whole) * SCALE + BigInt(frac === '' ? '0' : frac));
}

/** Render an 18-dp scaled bigint as a decimal string with at most `dp` fraction digits (truncated). */
export function formatDecimal(v: bigint, dp = 6): string {
  const neg = v < 0n;
  const abs = neg ? -v : v;
  const whole = abs / SCALE;
  let frac = (abs % SCALE).toString().padStart(SCALE_DP, '0').slice(0, dp).replace(/0+$/, '');
  if (frac === '') frac = '';
  return `${neg ? '-' : ''}${whole.toString()}${frac ? '.' + frac : ''}`;
}

/** Convert base units (e.g. USDC 6dp "50000000") into a decimal string ("50"). */
export function fromBaseUnits(raw: string, decimals: number): string {
  const neg = raw.startsWith('-');
  const digits = (neg ? raw.slice(1) : raw).replace(/\D/g, '') || '0';
  const padded = digits.padStart(decimals + 1, '0');
  const whole = padded.slice(0, padded.length - decimals);
  const frac = decimals === 0 ? '' : padded.slice(padded.length - decimals).replace(/0+$/, '');
  return `${neg ? '-' : ''}${whole}${frac ? '.' + frac : ''}`;
}

/** value / base in basis points, or null when base is zero (not computable). */
export function bpsOf(value: bigint, base: bigint): number | null {
  if (base === 0n) return null;
  // 6 extra digits of precision, then back to a float; magnitudes here are far below 2^53.
  const scaled = (value * 10000n * 1_000_000n) / base;
  return Number(scaled) / 1_000_000;
}

export function maxBig(a: bigint, b: bigint): bigint {
  return a > b ? a : b;
}
