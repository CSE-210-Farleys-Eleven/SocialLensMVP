import type { AdapterIssue, CoverageEntry, IdentityItem } from '../../adapters/contract';
import type { DashboardModel, FactsWidget, Section, TableCell, UiInputs, Widget } from '../contract';
import { AT_LEAST_PREFIX, formatCount, formatUtcDateTime, STATUS_TEXT, UNKNOWN_TEXT } from '../format';

const text = (t: string): TableCell => ({ text: t, style: 'text', href: null });
const code = (t: string): TableCell => ({ text: t, style: 'code', href: null });

/** Display names for collections SocialLens reads; anything else shows its NSID. */
const COLLECTION_LABELS: Readonly<Record<string, string>> = {
  'app.bsky.feed.post': 'Posts',
  'app.bsky.feed.like': 'Likes',
  'app.bsky.feed.repost': 'Reposts',
  'app.bsky.graph.follow': 'Follows',
  'app.bsky.graph.block': 'Blocks',
  'app.bsky.graph.list': 'Lists',
  'app.bsky.graph.listitem': 'List members',
  'app.bsky.actor.profile': 'Profile',
  engagement: 'Interaction counters',
};

/**
 * The identity card from adapters `IdentityItem`. Handle with the DID beneath; a handle whose
 * two-way check failed is flagged. Nothing is a link: the PDS URL is shown as text.
 */
export function identitySection(identity: IdentityItem | null): Section {
  const widgets: Widget[] = [];
  if (!identity) widgets.push({ kind: 'note', tone: 'warning', text: 'Your identity could not be read.' });

  const handleStatus =
    !identity || identity.handle === null
      ? ''
      : identity.handleVerified === true
        ? ''
        : identity.handleVerified === false
          ? 'Handle not confirmed'
          : 'Handle not checked';

  let pastHandles = UNKNOWN_TEXT;
  if (identity?.handleHistory) {
    const past = identity.handleHistory.filter((h) => h.handle !== identity.handle);
    pastHandles = past.length === 0 ? 'None' : past.map((h) => `${h.handle} (from ${formatUtcDateTime(h.firstSeenAt)})`).join(', ');
  }

  const facts: FactsWidget = {
    kind: 'facts',
    id: 'identity-card',
    title: null,
    items: [
      { label: 'Handle', value: text(identity ? (identity.handle ?? 'No handle') : UNKNOWN_TEXT), statusText: handleStatus },
      { label: 'DID', value: identity ? code(identity.did) : text(UNKNOWN_TEXT), statusText: '' },
      { label: 'Data server (PDS)', value: identity?.pdsUrl ? code(identity.pdsUrl) : text(UNKNOWN_TEXT), statusText: '' },
      { label: 'Account created', value: text(formatUtcDateTime(identity?.createdAt ?? null)), statusText: '' },
      { label: 'Past handles', value: text(pastHandles), statusText: '' },
    ],
  };
  widgets.push(facts);

  return {
    id: 'identity',
    title: 'Your account',
    description: 'Read from your DID document and the public PLC directory.',
    widgets,
  };
}

function coverageRow(e: CoverageEntry): TableCell[] {
  const failed = !e.complete && e.fetched === 0 && (e.reason === 'error' || e.reason === 'aborted');
  const status = e.complete ? 'Complete' : failed ? (e.reason === 'aborted' ? 'Cancelled' : 'Failed') : 'Partial';
  const records = failed ? UNKNOWN_TEXT : e.complete ? formatCount(e.fetched) : AT_LEAST_PREFIX + formatCount(e.fetched);
  let why = '';
  if (e.complete) why = e.fetched === 0 ? STATUS_TEXT.observedZero : '';
  else if (e.reason === 'record-cap') why = 'Stopped at the record cap; there may be more.';
  else if (e.reason === 'error') why = failed ? 'The read failed.' : 'The read failed part-way.';
  else if (e.reason === 'aborted') why = 'The read was cancelled.';
  else if (e.reason === 'not-indexed') why = 'Some items are not indexed yet.';
  else why = 'Not confirmed complete.';
  return [text(COLLECTION_LABELS[e.collection] ?? e.collection), code(e.collection), text(status), text(records), text(why)];
}

const SEVERITY_ORDER: Record<AdapterIssue['severity'], number> = { error: 0, warning: 1, info: 2 };
const SEVERITY_TEXT: Record<AdapterIssue['severity'], string> = { error: 'Error', warning: 'Warning', info: 'Info' };

/** What was read (adapters coverage) and what went wrong (adapters issues, user-safe messages). */
export function coverageSection(coverage: readonly CoverageEntry[], issues: readonly AdapterIssue[]): Section {
  const widgets: Widget[] = [];
  if (coverage.length === 0) {
    widgets.push({ kind: 'note', tone: 'warning', text: 'Nothing was read yet, so there is no coverage to show.' });
  } else {
    const done = coverage.filter((c) => c.complete).length;
    widgets.push({
      kind: 'note',
      tone: done === coverage.length ? 'info' : 'warning',
      text: `${done} of ${coverage.length} reads finished completely.`,
    });
  }

  widgets.push({
    kind: 'table',
    id: 'coverage-table',
    title: 'What was read',
    columns: [
      { id: 'name', label: 'Data' },
      { id: 'nsid', label: 'Collection' },
      { id: 'status', label: 'Status' },
      { id: 'records', label: 'Records' },
      { id: 'why', label: 'Notes' },
    ],
    rows: coverage.map(coverageRow),
    emptyText: 'Nothing was read.',
    totalRows: coverage.length,
  });

  const sorted = [...issues].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
  widgets.push({
    kind: 'table',
    id: 'issues-table',
    title: 'Problems while reading',
    columns: [
      { id: 'severity', label: 'Severity' },
      { id: 'message', label: 'Message' },
      { id: 'collection', label: 'Collection' },
    ],
    rows: sorted.map((i) => [text(SEVERITY_TEXT[i.severity]), text(i.message), i.collection ? code(i.collection) : text('—')]),
    emptyText: 'No problems were reported.',
    totalRows: sorted.length,
  });

  return {
    id: 'coverage',
    title: 'What was read',
    description: 'Coverage of the whole read. Numbers elsewhere are only as complete as this.',
    widgets,
  };
}

/** 'demo' when any input came from fixtures, so synthetic data is never presented as real. */
export function dashboardMode(inputs: UiInputs): DashboardModel['mode'] {
  const sources = [
    ...inputs.coverage.map((c) => c.source),
    ...(inputs.analytics ? [...inputs.analytics.coverage.posts, ...inputs.analytics.coverage.engagement].map((c) => c.source) : []),
    inputs.identity?.source,
    inputs.profile?.source,
    ...inputs.issues.map((i) => i.source),
  ];
  return sources.includes('fixtures') ? 'demo' : 'live';
}
