/**
 * The only place numbers become text. Locale-independent on purpose: output must be identical in
 * every browser and in tests. Renderers print these strings; they never format numbers themselves.
 */
import type { MetricFormat, MetricStatus } from './contract';

export const AT_LEAST_PREFIX = 'At least ';
export const UNKNOWN_TEXT = 'Unknown';
export const NOT_AVAILABLE_TEXT = 'Not available';

export const STATUS_TEXT = {
  observedZero: 'Observed zero',
  partial: 'Partial',
  unknown: 'Unknown',
  notAvailable: 'Not available on this app',
} as const;

function group(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** Round half away from zero to `decimals` places and group the integer part with commas. */
function fixed(n: number, decimals: 0 | 1): string {
  const factor = decimals === 1 ? 10 : 1;
  const rounded = Math.round((Math.abs(n) + Number.EPSILON) * factor) / factor;
  const [int = '0', frac] = rounded.toFixed(decimals).split('.');
  const sign = n < 0 && rounded !== 0 ? '-' : '';
  return sign + group(int) + (frac === undefined ? '' : `.${frac}`);
}

/**
 * "12", "1,234", "At least 12", "3.5", "67%", "Unknown", "Not available".
 * A missing or non-finite value prints "Unknown", never 0 or NaN.
 */
export function formatMetricValue(
  value: number | null,
  status: MetricStatus,
  isLowerBound: boolean,
  format: MetricFormat,
): string {
  if (status === 'not-available') return NOT_AVAILABLE_TEXT;
  if (status === 'unknown' || value === null || !Number.isFinite(value)) return UNKNOWN_TEXT;
  const text = format === 'percent' ? `${fixed(value * 100, 0)}%` : fixed(value, format === 'decimal1' ? 1 : 0);
  return status === 'partial' && isLowerBound ? AT_LEAST_PREFIX + text : text;
}

/** The label printed next to a value: "" for an ordinary complete value. */
export function statusTextFor(value: number | null, status: MetricStatus): string {
  if (status === 'not-available') return STATUS_TEXT.notAvailable;
  if (status === 'unknown' || value === null || !Number.isFinite(value)) return STATUS_TEXT.unknown;
  if (status === 'partial') return STATUS_TEXT.partial;
  return value === 0 ? STATUS_TEXT.observedZero : '';
}
