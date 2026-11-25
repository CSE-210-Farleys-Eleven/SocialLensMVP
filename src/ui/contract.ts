/**
 * ui — public contract. Documentation: transition/ui/README.md.
 *
 * The ui module has two layers:
 *   - core (this folder, src/ui/): framework-free TypeScript. It turns other modules' outputs
 *     (`UiInputs`) into a `DashboardModel`: every heading, number, label and note the page shows,
 *     already formatted. All product rules live here (unknown is never 0, "At least N",
 *     https-only links, no score).
 *   - renderer (separate package, stack not yet agreed): draws a `DashboardModel`. It holds no
 *     rules and does no data shaping, so replacing the stack never touches this contract.
 *
 * Everything here is plain JSON (no Date, Map, class instances or functions).
 */
import type {
  AdapterIssue,
  AtUri,
  CoverageEntry,
  Did,
  IdentityItem,
  IsoDateTime,
  ProfileStatsItem,
} from '../adapters/contract';
import type { TemporaryAccountsOutput } from './temporary/accounts-pr21';
import type { TemporaryAnalyticsResult } from './temporary/analytics-pr20';
import type { TemporaryAuthState } from './temporary/auth-session';
import type { TemporaryExtendedActivity } from './temporary/extended-activity';
import type { TemporaryPrivacyReport } from './temporary/privacy-observations';

export const UI_SCHEMA_VERSION = 1 as const;

// ---------------------------------------------------------------------------
// INPUT: what the ui core receives from the other modules (via the app shell)
// ---------------------------------------------------------------------------

/**
 * Everything the dashboard needs for one signed-in account. `null` means the supplier did not
 * run or failed; the dashboard then says so instead of showing zeros.
 * Fields typed `Temporary…` come from src/ui/temporary/ until their module exists on main.
 */
export interface UiInputs {
  /** analytics `analyze()` result (PR #20). */
  analytics: TemporaryAnalyticsResult | null;
  /** adapters identity card for the signed-in DID. */
  identity: IdentityItem | null;
  /** adapters public profile counters (display only). */
  profile: ProfileStatsItem | null;
  /** adapters coverage for every collection read (not only posts). */
  coverage: CoverageEntry[];
  /** adapters issues, user-safe messages. */
  issues: AdapterIssue[];
  /** registry/accounts `loadAccounts()` output without `request` (PR #21). */
  accounts: TemporaryAccountsOutput | null;
  /** Sign-in state (no auth module yet). */
  auth: TemporaryAuthState;
  /** Privacy observations (no module yet). */
  privacy: TemporaryPrivacyReport | null;
  /** Posting hours/weekdays, streaks, week-over-week, top posts (not computed by PR #20). */
  extendedActivity: TemporaryExtendedActivity | null;
}

// ---------------------------------------------------------------------------
// OUTPUT: DashboardModel, the only thing a renderer reads
// ---------------------------------------------------------------------------

export type ViewId = 'overview' | 'activity' | 'engagement' | 'privacy' | 'accounts';

/**
 * Honesty label of one number.
 * complete: fully observed (an observed 0 is a real zero).
 * partial: some data was not read; see `isLowerBound`.
 * unknown: nothing trustworthy was observed; `value` is null.
 * not-available: no supported app can supply it; `value` is null.
 */
export type MetricStatus = 'complete' | 'partial' | 'unknown' | 'not-available';

export type MetricFormat = 'integer' | 'decimal1' | 'percent';

/** One displayed number. Renderers print `valueText` and `statusText`; they never format `value`. */
export interface MetricValue {
  /** Glossary key, e.g. 'activity.posts', 'engagement.likes.average'. */
  id: string;
  label: string;
  /**
   * Raw number for charts and sorting. null when status is 'unknown' or 'not-available', or when
   * status is 'complete' but there was nothing to compute (an average over zero posts):
   * `valueText` then says why, e.g. "No posts".
   */
  value: number | null;
  status: MetricStatus;
  /** True only for a partial count that can only grow: printed "At least N". */
  isLowerBound: boolean;
  format: MetricFormat;
  /** Ready to print: "1,234", "At least 12", "3.5", "67%", "Unknown", "Not available", "No posts". */
  valueText: string;
  /** Ready to print next to the value: "", "Observed zero", "Partial", "Unknown", "Not available on this app". */
  statusText: string;
  /** Why the status is not 'complete' (plain language); null when complete. */
  reason: string | null;
  /** Extra context, e.g. "Average over 59 posts with a known count"; null when none. */
  detail: string | null;
}

export interface MetricWidget {
  kind: 'metric';
  metric: MetricValue;
}

/** A bar chart. Renderers must also offer `points` as a data table (every chart has a table). */
export interface ChartWidget {
  kind: 'chart';
  id: string;
  /** Includes the time basis, e.g. "Posts per day (UTC)". */
  title: string;
  axis: 'utc-day' | 'utc-hour' | 'utc-weekday';
  /** Column header for the point labels in the data table, e.g. "Date (UTC)". */
  labelHeader: string;
  /** One entry per stacked series, in drawing order. */
  series: { id: string; label: string }[];
  /** Contiguous, in axis order; `values[i]` belongs to `series[i]`. */
  points: { key: string; label: string; values: number[] }[];
  /** Indices into `points` that get an axis label (thinned by core). */
  axisLabelIndices: number[];
  status: MetricStatus;
  statusText: string;
  /** Shown instead of the chart when there is nothing to draw. */
  emptyText: string;
}

/** A table cell. `href` is set only for https URLs that core has checked; everything is text. */
export interface TableCell {
  text: string;
  style: 'text' | 'code' | 'number' | 'status';
  href: string | null;
}

export interface TableWidget {
  kind: 'table';
  id: string;
  title: string;
  columns: { id: string; label: string }[];
  rows: TableCell[][];
  /** Shown as the only row when `rows` is empty. */
  emptyText: string;
  /** Rows before any display cap; equals rows.length when nothing was cut. */
  totalRows: number;
}

/** Label/value pairs, e.g. an identity card. */
export interface FactsWidget {
  kind: 'facts';
  id: string;
  title: string | null;
  items: { label: string; value: TableCell; statusText: string }[];
}

/** Plain-language note. 'sample-data' marks content that comes from a temporary input. */
export interface NoteWidget {
  kind: 'note';
  tone: 'info' | 'warning' | 'sample-data';
  text: string;
}

/** A privacy observation. All four parts are always present. */
export interface ObservationWidget {
  kind: 'observation';
  id: string;
  title: string;
  summary: string;
  evidence: {
    /** "40", "At least 40" or "Unknown". */
    countText: string;
    /** "Earliest 2026-09-13 21:59 UTC · Latest 2026-11-09 11:11 UTC", or null. */
    dateRangeText: string | null;
    details: { label: string; value: string }[];
    /** Own record URIs, rendered as code text, never as links. */
    sampleUris: AtUri[];
  };
  /** Citation; `href` is null when the URL is not https. */
  source: { text: string; href: string | null; checkedText: string };
  limitation: string;
  action: string;
}

export type KnownWidget =
  | MetricWidget
  | ChartWidget
  | TableWidget
  | FactsWidget
  | NoteWidget
  | ObservationWidget;

export type WidgetKind = KnownWidget['kind'];

/**
 * Forward compatibility: a newer core may emit kinds an older renderer does not know.
 * Renderers must show `UNKNOWN_WIDGET_TEXT` for those and keep going (see `isKnownWidget`).
 */
export type Widget = KnownWidget | { kind: string };

export const UNKNOWN_WIDGET_TEXT = 'This statistic needs a newer version of the SocialLens page.';

export interface Section {
  id: string;
  title: string;
  description: string | null;
  widgets: Widget[];
}

export interface ViewModel {
  id: ViewId;
  /** Navigation label and page heading. */
  title: string;
  /** False when the view has nothing to show yet (e.g. no analysis); the nav item is disabled. */
  available: boolean;
  sections: Section[];
}

export interface DashboardModel {
  schemaVersion: typeof UI_SCHEMA_VERSION;
  /** 'demo' when any input came from fixtures: renderers then show `DEMO_BANNER_TEXT` on every view. */
  mode: 'live' | 'demo';
  /** Snapshot time, null when nothing was read. */
  fetchedAt: IsoDateTime | null;
  subject: { did: Did; handle: string | null } | null;
  /** Navigation order. */
  views: ViewModel[];
  /** Footer lines, e.g. "Counts are observations, not scores. Times are UTC." */
  footer: string[];
}

export const DEMO_BANNER_TEXT =
  'Synthetic demo data: fictional records, no real account, no network requests.';
