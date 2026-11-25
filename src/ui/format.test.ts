import { describe, expect, it } from 'vitest';
import { formatMetricValue, statusTextFor } from './format';

describe('formatMetricValue', () => {
  it.each([
    [12, 'complete', false, 'integer', '12'],
    [0, 'complete', false, 'integer', '0'],
    [1234, 'complete', false, 'integer', '1,234'],
    [1234567, 'complete', false, 'integer', '1,234,567'],
    [-1234, 'complete', false, 'integer', '-1,234'],
    [12.6, 'complete', false, 'integer', '13'],
    [12, 'partial', true, 'integer', 'At least 12'],
    [1000, 'partial', true, 'integer', 'At least 1,000'],
    [3.44, 'partial', false, 'decimal1', '3.4'],
    [5, 'complete', false, 'decimal1', '5.0'],
    [3.45, 'complete', false, 'decimal1', '3.5'],
    [-3.45, 'complete', false, 'decimal1', '-3.5'],
    [1234.56, 'complete', false, 'decimal1', '1,234.6'],
    [0.666, 'complete', false, 'percent', '67%'],
    [1.5, 'complete', false, 'percent', '150%'],
    [null, 'unknown', false, 'integer', 'Unknown'],
    [null, 'not-available', false, 'integer', 'Not available'],
  ] as const)('%s %s lowerBound=%s %s -> %s', (value, status, lower, format, expected) => {
    expect(formatMetricValue(value, status, lower, format)).toBe(expected);
  });

  it('never prints a number for unknown or not-available, even if one is passed', () => {
    expect(formatMetricValue(7, 'unknown', false, 'integer')).toBe('Unknown');
    expect(formatMetricValue(7, 'not-available', false, 'integer')).toBe('Not available');
  });

  it('prints "Unknown", never 0 or NaN, for a missing or non-finite value', () => {
    expect(formatMetricValue(null, 'complete', false, 'integer')).toBe('Unknown');
    expect(formatMetricValue(Number.NaN, 'complete', false, 'decimal1')).toBe('Unknown');
    expect(formatMetricValue(Number.POSITIVE_INFINITY, 'partial', true, 'integer')).toBe('Unknown');
  });

  it('does not depend on the runtime locale', () => {
    expect(formatMetricValue(9876543.21, 'complete', false, 'decimal1')).toBe('9,876,543.2');
  });
});

describe('statusTextFor', () => {
  it.each([
    [5, 'complete', ''],
    [0, 'complete', 'Observed zero'],
    [5, 'partial', 'Partial'],
    [0, 'partial', 'Partial'],
    [null, 'unknown', 'Unknown'],
    [null, 'not-available', 'Not available on this app'],
    [null, 'complete', 'Unknown'],
  ] as const)('%s %s -> "%s"', (value, status, expected) => {
    expect(statusTextFor(value, status)).toBe(expected);
  });
});
