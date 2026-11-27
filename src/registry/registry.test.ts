// Offline tests for loadAccounts over a fake network. Run with: npm test
import { describe, expect, it } from "vitest";
import { appIdOf, buildRegistry, collectionsToRequest, loadAccounts, lookupApp } from "./index";
import type { AuthInput } from "./contract";

// ---------- fake identities (fixture names only) ----------

const SELF = 'did:plc:fixtureself';
const PDS = 'https://pds.fixture.test';
const enc = encodeURIComponent;
const CLOCK = () => new Date('2026-01-01T00:00:00.000Z');

// ---------- fake network ----------

const routes: Record<string, unknown> = {
  [`${PDS}/xrpc/com.atproto.repo.describeRepo?repo=${enc(SELF)}`]: {
    collections: ['app.bsky.feed.post', 'app.bsky.feed.like', 'site.standard.document', 'pub.leaflet.document', 'app.sociallens.linkedAccount', 'com.example.thing'],
  },
};


let requested: string[] = [];
/** Answers from `routes`; anything else is a 404. */
const fakeFetch = (async (url: string) => {
  requested.push(url);
  const body = routes[url];
  return body ? new Response(JSON.stringify(body), { status: 200 }) : new Response("{}", { status: 404 });
}) as typeof fetch;

/** Every request fails with 503. */
const downFetch = (async () => new Response("{}", { status: 503 })) as typeof fetch;

// ---------- fake sign-in ----------

const sessionFetch = (async () => new Response("{}")) as typeof fetch; // stands in for the OAuth fetch
const auth = (pdsUrl = PDS): AuthInput => ({
  info: {
    status: 'signed-in',
    did: SELF,
    handle: 'self.fixture.test',
    pdsUrl,
    authServer: 'https://auth.fixture.test',
    scopes: ['atproto'],
    signedInAt: '2026-01-01T00:00:00.000Z',
  },
  fetch: sessionFetch,
});

// ---------- tests with fake network, accounts.ts ----------

describe('loadAccounts: typical', async () => {
  requested = [];
  const out = await loadAccounts(auth(), { fetch: fakeFetch, now: CLOCK, adapterOptions: { maxRecordsPerCollection: 500 } });
  const sent = [...requested];
  const [self] = out.accounts;

  it('returns only the signed-in account (self-only)', () => {
    expect(out.schemaVersion).toBe(1);
    expect(out.accounts.map((a) => a.verification)).toEqual(['self']);
  });

  it('makes one request and never reads link records', () => {
    expect(sent).toHaveLength(1);
    expect(sent.some((u) => u.includes('linkedAccount'))).toBe(false);
  });

  it('groups the signed-in repo into apps, supported first', () => {
    expect(self?.apps.map((a) => a.id)).toEqual(['app.bsky', 'pub.leaflet', 'site.standard', 'com.example', 'app.sociallens']);
  });

  it("requests only supported apps' collections", () => {
    expect(self?.request?.collections).toEqual(['app.bsky.feed.like', 'app.bsky.feed.post']);
  });

  it('sends the subject as did, handle and an https origin', () => {
    expect(self?.request?.subject).toEqual({ did: SELF, handle: 'self.fixture.test', pdsUrl: PDS });
  });

  it('gives the signed-in account a session with the auth fetch', () => {
    expect(self?.request?.session?.did).toBe(SELF);
    expect(self?.request?.session?.fetch).toBe(sessionFetch);
  });

  it('copies adapter options into the request', () => {
    expect(self?.request?.options?.maxRecordsPerCollection).toBe(500);
  });

  it('uses the injected clock and is complete', () => {
    expect(out.generatedAt).toBe('2026-01-01T00:00:00.000Z');
    expect(out.issues).toEqual([]);
    expect(out.complete).toBe(true);
  });
});

describe('loadAccounts: data server down', async () => {
  const out = await loadAccounts(auth(), { fetch: downFetch, now: CLOCK });

  it('never rejects and keeps the signed-in account', () => {
    expect(out.accounts).toHaveLength(1);
    expect(out.accounts[0]?.verification).toBe('self');
  });

  it('omits collections so the adapter discovers them', () => {
    expect(out.accounts[0]?.request?.collections).toBeUndefined();
  });

  it('reports a retryable http error with no URL and is incomplete', () => {
    expect(out.issues).toHaveLength(1);
    expect(out.issues[0]?.code).toBe('http-error');
    expect(out.issues[0]?.retryable).toBe(true);
    expect(out.issues[0]?.message).not.toMatch(/https?:/);
    expect(out.complete).toBe(false);
  });
});

describe('loadAccounts: unsafe data server URL', async () => {
  requested = [];
  const out = await loadAccounts(auth('http://192.168.1.1'), { fetch: fakeFetch, now: CLOCK });
  const sent = [...requested];

  it('sends no request to it and reports unsafe-url', () => {
    expect(sent).toHaveLength(0);
    expect(out.issues[0]?.code).toBe('unsafe-url');
    expect(out.accounts[0]?.request.subject).toEqual({ did: SELF, handle: 'self.fixture.test' });
    expect(out.accounts[0]?.request?.collections).toBeUndefined();
    expect(out.complete).toBe(false);
  });
});

describe('loadAccounts: cancelled', async () => {
  const ctrl = new AbortController();
  ctrl.abort();
  // Like real fetch: rejects at once if the signal is already aborted, otherwise when it aborts.
  const hangingFetch = ((_url: string, init?: RequestInit) =>
    new Promise((_, reject) => {
      if (init?.signal?.aborted) reject(new Error('aborted'));
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
    })) as typeof fetch;
  const out = await loadAccounts(auth(), { fetch: hangingFetch, now: CLOCK, signal: ctrl.signal });

  it('reports aborted instead of hanging', () => {
    expect(out.issues[0]?.code).toBe('aborted');
  });
});

// ---------- registry.ts on its own (no network) ----------

describe('registry: appIdOf', () => {
  it('keeps the first two segments of a collection name', () => {
    expect(appIdOf('app.bsky.feed.post')).toBe('app.bsky');
    expect(appIdOf('pub.leaflet.document')).toBe('pub.leaflet');
  });
});

describe('registry: lookupApp', () => {
  it('returns known apps from KNOWN_APPS', () => {
    expect(lookupApp('app.bsky')).toEqual({ id: 'app.bsky', name: 'Bluesky', supported: true });
  });

  it('names unknown apps by their domain and marks them unsupported', () => {
    expect(lookupApp('com.example')).toEqual({ id: 'com.example', name: 'example.com', supported: false });
  });
});

describe('registry: buildRegistry', () => {
  it('returns no apps for an empty repo', () => {
    expect(buildRegistry([])).toEqual([]);
  });

  it("groups one app's collections into one entry, sorted", () => {
    expect(buildRegistry(['app.bsky.feed.post', 'app.bsky.feed.like'])).toEqual([
      { id: 'app.bsky', name: 'Bluesky', supported: true, collections: ['app.bsky.feed.like', 'app.bsky.feed.post'] },
    ]);
  });

  it('orders supported, then known, then unknown apps, alphabetical within each', () => {
    const apps = buildRegistry([
      'com.zeta.thing',
      'site.standard.document',
      'com.example.thing',
      'pub.leaflet.document',
      'app.bsky.feed.post',
    ]);
    expect(apps.map((a) => a.id)).toEqual(['app.bsky', 'pub.leaflet', 'site.standard', 'com.example', 'com.zeta']);
  });
});

describe('registry: collectionsToRequest', () => {
  it("returns only supported apps' collections", () => {
    const apps = buildRegistry(['app.bsky.feed.post', 'app.bsky.feed.like', 'pub.leaflet.document', 'com.example.thing']);
    expect(collectionsToRequest(apps)).toEqual(['app.bsky.feed.like', 'app.bsky.feed.post']);
  });

  it("returns nothing when no app is supported", () => {
    expect(collectionsToRequest(buildRegistry(['pub.leaflet.document']))).toEqual([]);
  });
});