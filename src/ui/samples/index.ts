/**
 * Synthetic `UiInputs` for development, tests and the demo. Fictional identities only
 * (`did:plc:fixture…`, `*.fixture.test`); every coverage entry has `source: 'fixtures'`, so the
 * dashboard built from them is always in demo mode.
 * Scenarios follow Test_Module_SocialLens@2b2e993's demo (complete, partial, empty).
 */
import type { CoverageEntry, IdentityItem, IsoDateTime } from '../../adapters/contract';
import type { UiInputs } from '../contract';
import type { TemporaryAccountsOutput } from '../temporary/accounts-pr21';
import type { TemporaryAuthState } from '../temporary/auth-session';
import type { TemporaryCitation } from '../temporary/privacy-observations';

export type SampleId = 'complete' | 'partial' | 'empty';

export interface SampleScenario {
  id: SampleId;
  label: string;
  description: string;
  inputs: UiInputs;
}

const PDS = 'https://pds.fixture.test';
const BSKY_PRIVACY: TemporaryCitation = {
  title: 'Privacy Policy (updated 2025-08-14)',
  publisher: 'Bluesky Social PBC',
  url: 'https://bsky.social/about/support/privacy-policy',
  accessed: '2026-11-18',
};

function coverage(collection: string, fetched: number, complete = true, reason?: CoverageEntry['reason']): CoverageEntry {
  return reason ? { source: 'fixtures', collection, fetched, complete, reason } : { source: 'fixtures', collection, fetched, complete };
}

function identity(did: string, handle: string, fetchedAt: IsoDateTime, handleVerified: boolean | null): IdentityItem {
  return {
    kind: 'identity',
    source: 'fixtures',
    fetchedAt,
    did,
    didMethod: 'plc',
    handle,
    handleVerified,
    pdsUrl: PDS,
    createdAt: '2024-02-01T09:00:00.000Z',
    handleHistory: [
      { handle: `old-${handle}`, firstSeenAt: '2024-02-01T09:00:00.000Z' },
      { handle, firstSeenAt: '2025-03-15T12:00:00.000Z' },
    ],
  };
}

function signedIn(did: string, handle: string, at: IsoDateTime): TemporaryAuthState {
  return {
    status: 'signed-in',
    session: { status: 'signed-in', did, handle, pdsUrl: PDS, authServer: PDS, scopes: ['atproto'], signedInAt: at },
    failureMessage: null,
  };
}

function selfOnly(did: string, handle: string, at: IsoDateTime): TemporaryAccountsOutput {
  return {
    schemaVersion: 1,
    generatedAt: at,
    accounts: [
      {
        did,
        handle,
        pdsUrl: PDS,
        verification: 'self',
        apps: [{ id: 'app.bsky', name: 'Bluesky', supported: true, collections: ['app.bsky.feed.like', 'app.bsky.feed.post', 'app.bsky.graph.follow'] }],
      },
    ],
    issues: [],
    complete: true,
  };
}

/** `days` consecutive UTC dates ending at `end` (YYYY-MM-DD), with counts from `pattern` (repeated). */
function days(end: string, count: number, pattern: number[]): { date: string; postCount: number }[] {
  const endMs = Date.parse(`${end}T00:00:00.000Z`);
  const out: { date: string; postCount: number }[] = [];
  for (let i = count - 1; i >= 0; i -= 1) {
    const postCount = pattern[(count - 1 - i) % pattern.length] ?? 0;
    if (postCount > 0) out.push({ date: new Date(endMs - i * 86_400_000).toISOString().slice(0, 10), postCount });
  }
  return out;
}

const sum = (rows: { postCount: number }[]): number => rows.reduce((n, r) => n + r.postCount, 0);

const zeroBins = (labels: string[]) => labels.map((label) => ({ label, count: 0 }));
const HOURS = Array.from({ length: 24 }, (_, h) => String(h).padStart(2, '0'));
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// ---------------------------------------------------------------------------
// complete: every collection read to the end, every counter known
// ---------------------------------------------------------------------------

const C_AT = '2026-11-10T20:30:00.000Z';
const C_DID = 'did:plc:fixturecomplete00000000001';
const C_HANDLE = 'complete.fixture.test';
const C_DAYS = days('2026-11-10', 30, [2, 2, 3, 2, 2, 1, 2]);
const C_POSTS = sum(C_DAYS);

const complete: UiInputs = {
  analytics: {
    fetchedAt: C_AT,
    activity: {
      status: 'complete',
      postCount: C_POSTS,
      originals: C_POSTS - 16,
      replies: 16,
      unknownReplyStatus: 0,
      undatedPosts: 0,
      byUtcDay: C_DAYS,
    },
    engagement: {
      likeCount: { status: 'complete', total: 312, average: 312 / C_POSTS, measuredPosts: C_POSTS },
      repostCount: { status: 'complete', total: 58, average: 58 / C_POSTS, measuredPosts: C_POSTS },
      replyCount: { status: 'complete', total: 77, average: 77 / C_POSTS, measuredPosts: C_POSTS },
      quoteCount: { status: 'complete', total: 16, average: 16 / C_POSTS, measuredPosts: C_POSTS },
    },
    coverage: {
      posts: [coverage('app.bsky.feed.post', C_POSTS)],
      engagement: [coverage('engagement', C_POSTS)],
    },
  },
  identity: identity(C_DID, C_HANDLE, C_AT, true),
  profile: {
    kind: 'profile-stats',
    source: 'fixtures',
    fetchedAt: C_AT,
    did: C_DID,
    handle: C_HANDLE,
    displayName: 'Complete Sample',
    followersCount: 210,
    followsCount: 12,
    postsCount: C_POSTS,
    createdAt: '2024-02-01T09:00:00.000Z',
  },
  coverage: [
    coverage('app.bsky.feed.post', C_POSTS),
    coverage('app.bsky.feed.like', 40),
    coverage('app.bsky.graph.follow', 12),
    coverage('engagement', C_POSTS),
  ],
  issues: [],
  accounts: selfOnly(C_DID, C_HANDLE, C_AT),
  auth: signedIn(C_DID, C_HANDLE, C_AT),
  privacy: {
    observations: [
      {
        id: 'public-likes',
        title: 'Your likes are public records',
        summary: 'In this synthetic example, 40 like records are public.',
        evidence: {
          count: 40,
          countCertainty: 'exact',
          sampleUris: [
            `at://${C_DID}/app.bsky.feed.like/3mzus5x2ri222`,
            `at://${C_DID}/app.bsky.feed.like/3mzr5icqli222`,
          ],
          earliestAt: '2026-09-13T21:59:00.000Z',
          latestAt: '2026-11-09T11:11:00.000Z',
          collections: ['app.bsky.feed.like'],
          details: [],
        },
        source: BSKY_PRIVACY,
        limitation:
          'The Bluesky app does not show other people a list of your likes, but each like is a public record that any software can read. SocialLens shows only what it fetched and cannot tell who has read these records.',
        action: 'Open a sample record to see exactly what is published. Unlike anything you would not want publicly tied to this account.',
      },
    ],
    notTriggered: [{ id: 'public-blocks', title: 'Your blocks are public records', reason: 'No block records were fetched.' }],
  },
  extendedActivity: {
    hours: { bins: HOURS.map((label, h) => ({ label, count: h >= 18 && h <= 22 ? 9 : h === 8 ? 16 : 0 })), status: 'complete' },
    weekdays: { bins: WEEKDAYS.map((label, d) => ({ label, count: [10, 9, 11, 9, 8, 6, 8][d] ?? 0 })), status: 'complete' },
    streak: {
      current: { value: 30, status: 'complete' },
      longest: { value: 30, status: 'complete' },
      currentStart: '2026-10-12',
      currentEnd: '2026-11-10',
      longestStart: '2026-10-12',
      longestEnd: '2026-11-10',
    },
    weekOverWeek: {
      current: { startDate: '2026-11-04', endDate: '2026-11-10', posts: { value: 14, status: 'complete' } },
      previous: { startDate: '2026-10-28', endDate: '2026-11-03', posts: { value: 14, status: 'complete' } },
      delta: 0,
    },
    topPosts: [
      {
        rank: 1,
        uri: `at://${C_DID}/app.bsky.feed.post/3mzp0st1aaa22`,
        createdAt: '2026-11-02T19:04:00.000Z',
        textPreview: 'A fictional post about tide pools.',
        likeCount: 41,
        repostCount: 9,
        replyCount: 6,
        quoteCount: 2,
        settling: false,
      },
      {
        rank: 2,
        uri: `at://${C_DID}/app.bsky.feed.post/3mzt0st2bbb22`,
        createdAt: '2026-11-10T08:15:00.000Z',
        textPreview: null,
        likeCount: 12,
        repostCount: 1,
        replyCount: 3,
        quoteCount: 0,
        settling: true,
      },
    ],
  },
};

// ---------------------------------------------------------------------------
// partial: post read hit the record cap, engagement read failed part-way
// ---------------------------------------------------------------------------

const P_AT = '2026-11-10T20:30:00.000Z';
const P_DID = 'did:plc:fixturepartial000000000001';
const P_HANDLE = 'partial.fixture.test';
const P_DAYS = days('2026-11-10', 90, [12, 0, 15, 11, 0, 9, 14]);
const P_DATED = sum(P_DAYS);
const P_UNDATED = 3;
const P_POSTS = P_DATED + P_UNDATED;
const P_MEASURED = P_POSTS - 120;

const partial: UiInputs = {
  analytics: {
    fetchedAt: P_AT,
    activity: {
      status: 'partial',
      postCount: P_POSTS,
      originals: P_POSTS - 200 - 4,
      replies: 200,
      unknownReplyStatus: 4,
      undatedPosts: P_UNDATED,
      byUtcDay: P_DAYS,
    },
    engagement: {
      likeCount: { status: 'partial', total: 2_140, average: 2_140 / P_MEASURED, measuredPosts: P_MEASURED },
      repostCount: { status: 'partial', total: 301, average: 301 / P_MEASURED, measuredPosts: P_MEASURED },
      replyCount: { status: 'partial', total: 0, average: 0, measuredPosts: P_MEASURED },
      quoteCount: { status: 'unknown', total: null, average: null, measuredPosts: 0 },
    },
    coverage: {
      posts: [coverage('app.bsky.feed.post', P_POSTS, false, 'record-cap')],
      engagement: [coverage('engagement', P_MEASURED, false, 'error')],
    },
  },
  identity: identity(P_DID, P_HANDLE, P_AT, false),
  profile: null,
  coverage: [
    coverage('app.bsky.feed.post', P_POSTS, false, 'record-cap'),
    coverage('app.bsky.feed.like', 0, false, 'error'),
    coverage('engagement', P_MEASURED, false, 'error'),
  ],
  issues: [
    {
      source: 'fixtures',
      code: 'rate-limited',
      severity: 'warning',
      message: 'The public API asked us to slow down; some counters were not read.',
      retryable: true,
    },
    {
      source: 'fixtures',
      code: 'http-error',
      severity: 'error',
      message: 'Your data server returned an error while listing likes.',
      retryable: true,
      collection: 'app.bsky.feed.like',
    },
  ],
  accounts: selfOnly(P_DID, P_HANDLE, P_AT),
  auth: signedIn(P_DID, P_HANDLE, P_AT),
  privacy: {
    observations: [
      {
        id: 'public-likes',
        title: 'Your likes are public records',
        summary: 'In this synthetic example, your like records could not be read, so how many are public is unknown.',
        evidence: {
          count: null,
          countCertainty: 'unknown',
          sampleUris: [],
          earliestAt: null,
          latestAt: null,
          collections: ['app.bsky.feed.like'],
          details: [{ label: 'Read status', value: 'Listing failed part-way' }],
        },
        source: { ...BSKY_PRIVACY, url: 'javascript:alert(1)' },
        limitation: 'SocialLens could not read your likes, so it cannot say how many are public.',
        action: 'Press "Read again" later.',
      },
    ],
    notTriggered: [],
  },
  extendedActivity: {
    hours: { bins: zeroBins(HOURS).map((b, h) => ({ ...b, count: h % 3 === 0 ? 40 : 10 })), status: 'partial' },
    weekdays: { bins: WEEKDAYS.map((label, d) => ({ label, count: [150, 0, 170, 140, 0, 120, 160][d] ?? 0 })), status: 'partial' },
    streak: {
      current: { value: 2, status: 'partial' },
      longest: { value: null, status: 'unknown' },
      currentStart: '2026-11-09',
      currentEnd: '2026-11-10',
      longestStart: null,
      longestEnd: null,
    },
    weekOverWeek: {
      current: { startDate: '2026-11-04', endDate: '2026-11-10', posts: { value: 61, status: 'partial' } },
      previous: { startDate: '2026-10-28', endDate: '2026-11-03', posts: { value: null, status: 'unknown' } },
      delta: null,
    },
    topPosts: [
      {
        rank: 1,
        uri: `at://${P_DID}/app.bsky.feed.post/3mzx0st3ccc22`,
        createdAt: null,
        textPreview: '<script>alert(1)</script> fictional post text must render as text',
        likeCount: 90,
        repostCount: 14,
        replyCount: 0,
        quoteCount: null,
        settling: false,
      },
    ],
  },
};

// ---------------------------------------------------------------------------
// empty: everything read to the end, nothing there (observed zeros)
// ---------------------------------------------------------------------------

const E_AT = '2026-11-10T20:30:00.000Z';
const E_DID = 'did:plc:fixtureempty00000000000001';
const E_HANDLE = 'empty.fixture.test';
const emptyMetric = { status: 'complete', total: 0, average: null, measuredPosts: 0 } as const;

const empty: UiInputs = {
  analytics: {
    fetchedAt: E_AT,
    activity: { status: 'complete', postCount: 0, originals: 0, replies: 0, unknownReplyStatus: 0, undatedPosts: 0, byUtcDay: [] },
    engagement: { likeCount: { ...emptyMetric }, repostCount: { ...emptyMetric }, replyCount: { ...emptyMetric }, quoteCount: { ...emptyMetric } },
    coverage: { posts: [coverage('app.bsky.feed.post', 0)], engagement: [coverage('engagement', 0)] },
  },
  identity: identity(E_DID, E_HANDLE, E_AT, null),
  profile: null,
  coverage: [coverage('app.bsky.feed.post', 0), coverage('app.bsky.feed.like', 0), coverage('engagement', 0)],
  issues: [],
  accounts: selfOnly(E_DID, E_HANDLE, E_AT),
  auth: signedIn(E_DID, E_HANDLE, E_AT),
  privacy: {
    observations: [],
    notTriggered: [
      { id: 'public-likes', title: 'Your likes are public records', reason: 'No like records were fetched.' },
      { id: 'public-blocks', title: 'Your blocks are public records', reason: 'No block records were fetched.' },
    ],
  },
  extendedActivity: {
    hours: { bins: zeroBins(HOURS), status: 'complete' },
    weekdays: { bins: zeroBins(WEEKDAYS), status: 'complete' },
    streak: {
      current: { value: 0, status: 'complete' },
      longest: { value: 0, status: 'complete' },
      currentStart: null,
      currentEnd: null,
      longestStart: null,
      longestEnd: null,
    },
    weekOverWeek: {
      current: { startDate: '2026-11-04', endDate: '2026-11-10', posts: { value: 0, status: 'complete' } },
      previous: { startDate: '2026-10-28', endDate: '2026-11-03', posts: { value: 0, status: 'complete' } },
      delta: 0,
    },
    topPosts: [],
  },
};

export const SAMPLE_SCENARIOS: readonly SampleScenario[] = [
  {
    id: 'complete',
    label: 'Complete sample',
    description: 'A fictional account whose every collection was read completely, with counters for every post.',
    inputs: complete,
  },
  {
    id: 'partial',
    label: 'Partial and unavailable reads',
    description: 'A fictional account where the post read hit its cap, a listing failed and some counters are missing.',
    inputs: partial,
  },
  {
    id: 'empty',
    label: 'Empty account',
    description: 'A fictional account with no records at all, so every count is an observed zero.',
    inputs: empty,
  },
];
