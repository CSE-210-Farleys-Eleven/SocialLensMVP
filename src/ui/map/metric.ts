import type { CoverageEntry } from '../../adapters/contract';
import type { MetricFormat, MetricStatus, MetricValue, MetricWidget } from '../contract';
import { formatMetricValue, statusTextFor } from '../format';
import { lookupMetric } from '../glossary';

export interface MetricSpec {
  id: string;
  value: number | null;
  status: MetricStatus;
  format: MetricFormat;
  /** Partial counts that can only grow with more data. Ignored unless status is 'partial'. */
  countCanOnlyGrow: boolean;
  reason?: string | null;
  detail?: string | null;
  /** Overrides the glossary label. */
  label?: string;
}

/**
 * Build one displayed number. Enforces the honesty rules in one place:
 * a null or non-finite value is 'unknown' whatever status was claimed, and an unknown or
 * not-available value carries no number.
 */
export function buildMetric(spec: MetricSpec): MetricValue {
  const usable = spec.value !== null && Number.isFinite(spec.value);
  const status: MetricStatus =
    spec.status === 'not-available' ? 'not-available' : usable ? spec.status : 'unknown';
  const value = status === 'unknown' || status === 'not-available' ? null : spec.value;
  const isLowerBound = status === 'partial' && spec.countCanOnlyGrow;
  return {
    id: spec.id,
    // Fallback to the id keeps the page rendering; a test requires a glossary entry for every id.
    label: spec.label ?? lookupMetric(spec.id)?.label ?? spec.id,
    value,
    status,
    isLowerBound,
    format: spec.format,
    valueText: formatMetricValue(value, status, isLowerBound, spec.format),
    statusText: statusTextFor(value, status),
    reason: status === 'complete' ? null : (spec.reason ?? null),
    detail: spec.detail ?? null,
  };
}

export function metricWidget(spec: MetricSpec): MetricWidget {
  return { kind: 'metric', metric: buildMetric(spec) };
}

const REASON_TEXT: Record<NonNullable<CoverageEntry['reason']>, string> = {
  'record-cap': 'stopped at its record cap, so there may be more',
  error: 'failed part-way',
  aborted: 'was cancelled before it finished',
  'not-indexed': 'is missing items the service has not indexed yet',
};

/**
 * Plain-language reason for incomplete coverage, e.g.
 * "Reading posts stopped at its record cap, so there may be more."
 */
export function coverageReason(entries: readonly CoverageEntry[], what: string): string {
  const reasons = [...new Set(entries.filter((e) => !e.complete && e.reason).map((e) => e.reason!))];
  if (reasons.length === 0) return `Not every ${what.replace(/s$/, '')} could be confirmed as read.`;
  return `Reading ${what} ${reasons.map((r) => REASON_TEXT[r]).join('; it also ')}.`;
}
