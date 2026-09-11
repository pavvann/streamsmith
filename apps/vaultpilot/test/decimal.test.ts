/**
 * Money never touches a float in this app; these are the conversions everything else relies on.
 */
import {describe, expect, it} from 'vitest';
import {bpsOf, formatDecimal, fromBaseUnits, parseDecimal, SCALE} from '../src/decimal.js';

describe('parseDecimal', () => {
  it('scales decimal strings to 18 dp without losing the tail', () => {
    expect(parseDecimal('1')).toBe(SCALE);
    expect(parseDecimal('0.000001')).toBe(10n ** 12n);
    expect(parseDecimal('1.000000000000000001')).toBe(SCALE + 1n);
  });

  it('treats absent, empty and null-ish input as zero', () => {
    expect(parseDecimal(null)).toBe(0n);
    expect(parseDecimal(undefined)).toBe(0n);
    expect(parseDecimal('')).toBe(0n);
    expect(parseDecimal('null')).toBe(0n);
  });

  it('handles negatives', () => {
    expect(parseDecimal('-2.5')).toBe(-2n * SCALE - SCALE / 2n);
  });

  it('rejects anything that is not a decimal string', () => {
    expect(() => parseDecimal('1e18')).toThrow();
    expect(() => parseDecimal('0x10')).toThrow();
  });

  it('does not lose precision on values a float would round', () => {
    const a = parseDecimal('1000000000000.000000000000000001');
    const b = parseDecimal('1000000000000');
    expect(a - b).toBe(1n);
  });
});

describe('formatDecimal', () => {
  it('truncates rather than rounding, and drops trailing zeros', () => {
    expect(formatDecimal(parseDecimal('1.0000000'))).toBe('1');
    expect(formatDecimal(parseDecimal('1.2345678'), 6)).toBe('1.234567');
    expect(formatDecimal(parseDecimal('-0.5'))).toBe('-0.5');
  });
});

describe('fromBaseUnits', () => {
  it('converts USDC base units exactly', () => {
    expect(fromBaseUnits('50000000', 6)).toBe('50');
    expect(fromBaseUnits('25500000', 6)).toBe('25.5');
    expect(fromBaseUnits('1', 6)).toBe('0.000001');
    expect(fromBaseUnits('0', 6)).toBe('0');
  });

  it('handles 18-decimal shares and zero-decimal assets', () => {
    expect(fromBaseUnits('1000000000000000000', 18)).toBe('1');
    expect(fromBaseUnits('42', 0)).toBe('42');
  });
});

describe('bpsOf', () => {
  it('is null when there is no denominator, never zero', () => {
    expect(bpsOf(parseDecimal('5'), 0n)).toBeNull();
  });

  it('measures a share of the base in basis points', () => {
    expect(bpsOf(parseDecimal('1'), parseDecimal('10000'))).toBe(1);
    expect(bpsOf(parseDecimal('60100'), parseDecimal('12010500.9'))).toBeCloseTo(50.04, 2);
  });
});
