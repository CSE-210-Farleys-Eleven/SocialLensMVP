/**
 * Deterministic synthetic accounts. Everything here is obviously fake:
 * DIDs start with "did:plc:fixture", handles end in ".fixture.test",
 * and the PDS is https://pds.fixture.test. No real person is modelled.
 */

export type FixtureScenario =
  /** ~60 posts plus likes, reposts, follows, blocks, a Standard.site document. */
  | 'typical'
  /** Valid account, every collection empty. */
  | 'empty'
  /** PDS answers, but the AppView returns 503 (engagement unavailable). */
  | 'appview-down'
  /** AppView returns 429 with a Retry-After longer than we are willing to wait. */
  | 'rate-limited'
  /** The PDS returns 503 for everything. */
  | 'pds-down';

export const FIXTURE_SCENARIOS: readonly FixtureScenario[] = [
  'typical',
  'empty',
  'appview-down',
  'rate-limited',
  'pds-down',
];

export const FIXTURE_DID = 'did:plc:fixtureaaaaaaaaaaaaaaaaa';
export const FIXTURE_HANDLE = 'alice.fixture.test';
export const FIXTURE_OLD_HANDLE = 'alice-old.fixture.test';
export const FIXTURE_PDS = 'https://pds.fixture.test';
export const FIXTURE_CREATED_AT = '2025-03-01T12:00:00.000Z';
export const FIXTURE_HANDLE_CHANGED_AT = '2025-09-15T08:30:00.000Z';
export const FIXTURE_NOW = '2026-01-01T00:00:00.000Z';
/** Another fake, well-formed did:plc (24 base32 chars). */
const OTHER_DID = (n: number) => `did:plc:fixture${'b'.repeat(16)}${(n % 6) + 2}`;

export interface FixtureRecord {
  uri: string;
  cid: string;
  value: Record<string, unknown>;
}
export interface FixturePostCounts {
  likeCount: number;
  repostCount: number;
  replyCount: number;
  quoteCount: number;
}
export interface FixtureDataset {
  scenario: FixtureScenario;
  did: string;
  handle: string;
  /** collection NSID -> records, in repo order (oldest first). */
  collections: Record<string, FixtureRecord[]>;
  /** post uri -> counts the AppView would report. */
  postCounts: Record<string, FixturePostCounts>;
  profile: { displayName: string; followersCount: number; followsCount: number; postsCount: number; createdAt: string };
}

/** Small seeded PRNG so the dataset is identical on every run. */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TID_ALPHABET = '234567abcdefghijklmnopqrstuvwxyz';
function rkey(n: number): string {
  // Fake TID-like key: 13 chars, base32-sortable, deterministic.
  let s = '';
  let v = n + 1000;
  for (let i = 0; i < 13; i++) {
    s = TID_ALPHABET[v % 32]! + s;
    v = Math.floor(v / 32);
  }
  return s;
}
function fakeCid(kind: string, n: number): string {
  return `bafyfixture${kind}${String(n).padStart(6, '0')}`;
}

const BASE_MS = Date.parse('2025-09-01T00:00:00.000Z');
const DAY = 86_400_000;

export function buildDataset(scenario: FixtureScenario = 'typical'): FixtureDataset {
  const empty = scenario === 'empty';
  const rand = mulberry32(210);
  const did = FIXTURE_DID;
  const uri = (collection: string, key: string) => `at://${did}/${collection}/${key}`;
  const collections: Record<string, FixtureRecord[]> = {
    'app.bsky.actor.profile': [],
    'app.bsky.feed.post': [],
    'app.bsky.feed.like': [],
    'app.bsky.feed.repost': [],
    'app.bsky.graph.follow': [],
    'app.bsky.graph.block': [],
    'site.standard.document': [],
  };
  const postCounts: Record<string, FixturePostCounts> = {};

  if (!empty) {
    collections['app.bsky.actor.profile']!.push({
      uri: uri('app.bsky.actor.profile', 'self'),
      cid: fakeCid('prof', 0),
      value: { $type: 'app.bsky.actor.profile', displayName: 'Alice Fixture', description: 'Synthetic test account.' },
    });

    const postUris: string[] = [];
    for (let i = 0; i < 60; i++) {
      const key = rkey(i);
      const u = uri('app.bsky.feed.post', key);
      const createdAt = new Date(BASE_MS + i * 2 * DAY + Math.floor(rand() * 20) * 3_600_000).toISOString();
      const isReply = i % 7 === 3 && postUris.length > 0;
      const value: Record<string, unknown> = {
        $type: 'app.bsky.feed.post',
        text: `Fixture post ${i} ${i % 4 === 0 ? '#fixture' : ''}`.trim(),
        createdAt,
        langs: ['en'],
      };
      if (isReply) {
        const parent = { uri: postUris[postUris.length - 1]!, cid: fakeCid('post', i - 1) };
        value.reply = { root: parent, parent };
      }
      collections['app.bsky.feed.post']!.push({ uri: u, cid: fakeCid('post', i), value });
      postUris.push(u);
      postCounts[u] = {
        likeCount: Math.floor(rand() * 40),
        repostCount: Math.floor(rand() * 8),
        replyCount: Math.floor(rand() * 6),
        quoteCount: Math.floor(rand() * 3),
      };
    }
    for (let i = 0; i < 40; i++) {
      collections['app.bsky.feed.like']!.push({
        uri: uri('app.bsky.feed.like', rkey(100 + i)),
        cid: fakeCid('like', i),
        value: {
          $type: 'app.bsky.feed.like',
          subject: { uri: `at://${OTHER_DID(i)}/app.bsky.feed.post/${rkey(i)}`, cid: fakeCid('xpost', i) },
          createdAt: new Date(BASE_MS + i * 3 * DAY).toISOString(),
        },
      });
    }
    for (let i = 0; i < 8; i++) {
      collections['app.bsky.feed.repost']!.push({
        uri: uri('app.bsky.feed.repost', rkey(200 + i)),
        cid: fakeCid('rep', i),
        value: {
          $type: 'app.bsky.feed.repost',
          subject: { uri: `at://${OTHER_DID(i)}/app.bsky.feed.post/${rkey(i)}`, cid: fakeCid('xpost', i) },
          createdAt: new Date(BASE_MS + i * 9 * DAY).toISOString(),
        },
      });
    }
    for (let i = 0; i < 25; i++) {
      collections['app.bsky.graph.follow']!.push({
        uri: uri('app.bsky.graph.follow', rkey(300 + i)),
        cid: fakeCid('fol', i),
        value: { $type: 'app.bsky.graph.follow', subject: OTHER_DID(i), createdAt: new Date(BASE_MS + i * DAY).toISOString() },
      });
    }
    for (let i = 0; i < 2; i++) {
      collections['app.bsky.graph.block']!.push({
        uri: uri('app.bsky.graph.block', rkey(400 + i)),
        cid: fakeCid('blk', i),
        value: { $type: 'app.bsky.graph.block', subject: OTHER_DID(50 + i), createdAt: new Date(BASE_MS + i * 20 * DAY).toISOString() },
      });
    }
    collections['site.standard.document']!.push({
      uri: uri('site.standard.document', rkey(500)),
      cid: fakeCid('doc', 0),
      value: { $type: 'site.standard.document', title: 'Fixture article', publishedAt: new Date(BASE_MS + 30 * DAY).toISOString() },
    });
  }

  return {
    scenario,
    did,
    handle: FIXTURE_HANDLE,
    collections,
    postCounts,
    profile: {
      displayName: 'Alice Fixture',
      followersCount: empty ? 0 : 123,
      followsCount: collections['app.bsky.graph.follow']!.length,
      postsCount: collections['app.bsky.feed.post']!.length,
      createdAt: FIXTURE_CREATED_AT,
    },
  };
}
