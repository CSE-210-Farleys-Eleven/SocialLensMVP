import { describe, expect, it, vi } from 'vitest';
import type { AuthState } from './contract';
import type { OAuthPort, PortSession } from './port';
import { createAuth, META_KEY, normalizeIdentifier, type AuthStorage } from './service';

// ---------------------------------------------------------------------------
// Fakes. Fixture identities only.
// ---------------------------------------------------------------------------

const ALICE = 'did:plc:fixture-alice';
const BOB = 'did:plc:fixture-bob';
const PDS = 'https://pds.fixture.test';
const APP = 'https://app.fixture.test/';
const NOW = new Date('2026-01-01T00:00:00.000Z');

class Classified extends Error {
  constructor(
    public code: string,
    public retryable = false,
  ) {
    super(code);
  }
}

function portSession(did: string, handle = vi.fn(async () => new Response('{}', { status: 200 }))): PortSession {
  return { did, pdsUrl: PDS, authServer: 'https://auth.fixture.test', scopes: ['atproto'], handle };
}

function fakePort(opts: { stored?: string[]; handles?: Record<string, string | null> } = {}) {
  const stored = new Set(opts.stored ?? []);
  const handles = opts.handles ?? { [ALICE]: 'alice.fixture.test', [BOB]: 'bob.fixture.test' };
  const sessions = new Map<string, PortSession>();
  const port = {
    stored,
    sessions,
    authorizationUrl: vi.fn(async (id: string, _scope: string) => `https://auth.fixture.test/authorize?for=${id}`),
    finalize: vi.fn(async (_p: URLSearchParams): Promise<PortSession> => {
      const s = portSession(ALICE);
      stored.add(ALICE);
      sessions.set(ALICE, s);
      return s;
    }),
    restore: vi.fn(async (did: string): Promise<PortSession> => {
      if (!stored.has(did)) throw new Classified('session-expired');
      const s = sessions.get(did) ?? portSession(did);
      sessions.set(did, s);
      return s;
    }),
    storedDids: vi.fn(() => [...stored]),
    resolveHandle: vi.fn(async (did: string) => handles[did] ?? null),
    isAlive: vi.fn(async (_did: string) => true),
    signOut: vi.fn(async (did: string) => {
      stored.delete(did);
    }),
    forget: vi.fn((did: string) => {
      stored.delete(did);
    }),
    classify: vi.fn((err: unknown) =>
      err instanceof Classified
        ? { code: err.code as never, retryable: err.retryable }
        : { code: 'unexpected' as const, retryable: false },
    ),
  } satisfies OAuthPort & Record<string, unknown>;
  return port;
}

function memoryStorage(init: Record<string, string> = {}): AuthStorage & { data: Map<string, string> } {
  const data = new Map(Object.entries(init));
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

function fakeLocation(href = APP) {
  const loc = {
    current: href,
    assigned: [] as string[],
    href: () => loc.current,
    replace: vi.fn((u: string) => {
      loc.current = u;
    }),
    assign: vi.fn((u: string) => {
      loc.assigned.push(u);
    }),
  };
  return loc;
}

function setup(o: { stored?: string[]; meta?: object; href?: string; handles?: Record<string, string | null> } = {}) {
  const oauth = fakePort(o);
  const storage = memoryStorage(o.meta ? { [META_KEY]: JSON.stringify(o.meta) } : {});
  const location = fakeLocation(o.href);
  let external: (() => void) | null = null;
  const auth = createAuth({
    oauth,
    storage,
    location,
    now: () => NOW,
    watchExternal: (cb) => {
      external = cb;
      return () => {
        external = null;
      };
    },
  });
  return { auth, oauth, storage, location, fireExternal: () => external?.() };
}

const CALLBACK = `${APP}#state=s1&iss=https%3A%2F%2Fauth.fixture.test&code=c1`;
const tick = () => new Promise((r) => setTimeout(r, 0));

describe('normalizeIdentifier', () => {
  it('accepts handles (with @, any case) and plc/web DIDs', () => {
    expect(normalizeIdentifier('  @Alice.Fixture.TEST ')).toBe('alice.fixture.test');
    expect(normalizeIdentifier('did:plc:fixture-alice')).toBe('did:plc:fixture-alice');
    expect(normalizeIdentifier('did:web:alice.fixture.test')).toBe('did:web:alice.fixture.test');
  });
  it('rejects things that are not handles or supported DIDs', () => {
    for (const bad of ['', 'alice', 'alice.', '.alice.test', 'alice .test', 'did:key:z6Mk', 'https://alice.test', 'a.1']) {
      expect(normalizeIdentifier(bad), bad).toBeNull();
    }
  });
});

describe('init', () => {
  it('is signed out with nothing stored', async () => {
    const { auth, oauth } = setup();
    const s = await auth.init();
    expect(s).toEqual({ schemaVersion: 1, status: 'signed-out', accounts: [], activeDid: null, issues: [] });
    expect(oauth.finalize).not.toHaveBeenCalled();
  });

  it('completes an OAuth redirect: scrubs the URL first, then signs in with the token DID', async () => {
    const { auth, oauth, location, storage } = setup({ href: CALLBACK });
    oauth.finalize.mockImplementationOnce(async (p) => {
      // The code must already be gone from the address bar when it is exchanged.
      expect(location.current).toBe(APP);
      expect(p.get('code')).toBe('c1');
      oauth.stored.add(ALICE);
      return portSession(ALICE);
    });
    const s = await auth.init();
    expect(s.status).toBe('signed-in');
    expect(s.activeDid).toBe(ALICE);
    expect(s.accounts).toEqual([
      {
        status: 'signed-in',
        did: ALICE,
        handle: 'alice.fixture.test',
        pdsUrl: PDS,
        authServer: 'https://auth.fixture.test',
        scopes: ['atproto'],
        signedInAt: NOW.toISOString(),
      },
    ]);
    expect(JSON.parse(storage.data.get(META_KEY)!)).toEqual({
      accounts: [{ did: ALICE, handle: 'alice.fixture.test', signedInAt: NOW.toISOString() }],
      activeDid: ALICE,
    });
  });

  it('falls back to the DID when the handle cannot be resolved', async () => {
    const { auth } = setup({ href: CALLBACK, handles: {} });
    const s = await auth.init();
    expect(s.accounts[0]!.handle).toBe(ALICE);
  });

  it('reports a cancelled sign-in as an issue and stays signed out', async () => {
    const { auth, oauth, location } = setup({ href: `${APP}#state=s1&error=access_denied` });
    oauth.finalize.mockRejectedValueOnce(new Classified('cancelled', true));
    const s = await auth.init();
    expect(location.current).toBe(APP);
    expect(s.status).toBe('signed-out');
    expect(s.issues).toEqual([
      { source: 'auth', code: 'cancelled', severity: 'error', message: 'Sign-in was cancelled.', retryable: true },
    ]);
  });

  it('ignores fragments that are not OAuth callbacks', async () => {
    const { auth, oauth, location } = setup({ href: `${APP}#activity` });
    await auth.init();
    expect(oauth.finalize).not.toHaveBeenCalled();
    expect(location.replace).not.toHaveBeenCalled();
  });

  it('restores stored sessions in their saved order, with the saved active account, without network', async () => {
    const meta = {
      accounts: [
        { did: BOB, handle: 'bob.fixture.test', signedInAt: '2025-12-01T00:00:00.000Z' },
        { did: ALICE, handle: 'alice.fixture.test', signedInAt: '2025-12-02T00:00:00.000Z' },
      ],
      activeDid: ALICE,
    };
    const { auth, oauth } = setup({ stored: [ALICE, BOB], meta });
    const s = await auth.init();
    expect(s.accounts.map((a) => [a.did, a.handle, a.signedInAt])).toEqual([
      [BOB, 'bob.fixture.test', '2025-12-01T00:00:00.000Z'],
      [ALICE, 'alice.fixture.test', '2025-12-02T00:00:00.000Z'],
    ]);
    expect(s.activeDid).toBe(ALICE);
    expect(oauth.resolveHandle).not.toHaveBeenCalled();
  });

  it('adds a second account by signing in again; the new one is last and active', async () => {
    const meta = { accounts: [{ did: BOB, handle: 'bob.fixture.test', signedInAt: '2025-12-01T00:00:00.000Z' }], activeDid: BOB };
    const { auth } = setup({ stored: [BOB], meta, href: CALLBACK });
    const s = await auth.init();
    expect(s.accounts.map((a) => a.did)).toEqual([BOB, ALICE]);
    expect(s.activeDid).toBe(ALICE);
  });

  it('forgets a stored session that cannot be restored, and keeps one that failed transiently', async () => {
    const { auth, oauth } = setup({ stored: [ALICE, BOB] });
    oauth.restore.mockImplementation(async (did) => {
      throw did === ALICE ? new Classified('session-expired') : new Classified('network', true);
    });
    const s = await auth.init();
    expect(s.status).toBe('signed-out');
    expect(s.issues.map((i) => [i.code, i.did, i.severity])).toEqual([
      ['session-expired', ALICE, 'warning'],
      ['network', BOB, 'warning'],
    ]);
    expect(oauth.forget).toHaveBeenCalledWith(ALICE);
    expect(oauth.forget).not.toHaveBeenCalledWith(BOB);
  });

  it('drops a stale saved account list that has no stored session', async () => {
    const meta = { accounts: [{ did: BOB, handle: 'bob.fixture.test', signedInAt: '2025-12-01T00:00:00.000Z' }], activeDid: BOB };
    const { auth, storage } = setup({ meta });
    const s = await auth.init();
    expect(s.status).toBe('signed-out');
    expect(storage.data.has(META_KEY)).toBe(false);
  });

  it('tolerates a corrupt saved account list', async () => {
    const { auth, oauth, storage } = setup({ stored: [ALICE] });
    storage.data.set(META_KEY, '{not json');
    const s = await auth.init();
    expect(s.accounts.map((a) => a.did)).toEqual([ALICE]);
    expect(oauth.resolveHandle).toHaveBeenCalledWith(ALICE);
  });

  it('runs once even if called twice (a code is exchanged only once)', async () => {
    const { auth, oauth } = setup({ href: CALLBACK });
    const [a, b] = await Promise.all([auth.init(), auth.init()]);
    expect(a).toEqual(b);
    expect(oauth.finalize).toHaveBeenCalledTimes(1);
  });

  it('never rejects, even if the port throws unexpectedly', async () => {
    const { auth, oauth } = setup();
    oauth.storedDids.mockImplementation(() => {
      throw new Error('boom');
    });
    const s = await auth.init();
    expect(s.status).toBe('signed-out');
    expect(s.issues.map((i) => i.code)).toEqual(['unexpected']);
  });
});

describe('signIn', () => {
  it('normalises the identifier, requests the read-only scope and navigates to the provider', async () => {
    const { auth, oauth, location } = setup();
    await auth.init();
    await expect(auth.signIn('@Alice.Fixture.Test')).resolves.toBeNull();
    expect(oauth.authorizationUrl).toHaveBeenCalledWith('alice.fixture.test', 'atproto');
    expect(location.assigned).toEqual(['https://auth.fixture.test/authorize?for=alice.fixture.test']);
  });

  it('rejects an invalid identifier without contacting anything', async () => {
    const { auth, oauth, location } = setup();
    const issue = await auth.signIn('not a handle');
    expect(issue?.code).toBe('invalid-handle');
    expect(oauth.authorizationUrl).not.toHaveBeenCalled();
    expect(location.assigned).toEqual([]);
    expect(auth.getState().issues).toEqual([issue]);
  });

  it('returns resolution failures as issues without navigating, and never leaks the error text', async () => {
    const { auth, oauth, location } = setup();
    const err = new Classified('resolution-failed');
    err.message = 'GET https://secret.fixture.test/?token=abc failed';
    oauth.authorizationUrl.mockRejectedValueOnce(err);
    const issue = await auth.signIn('alice.fixture.test');
    expect(issue).toMatchObject({ source: 'auth', code: 'resolution-failed', severity: 'error' });
    expect(issue!.message).not.toContain('secret');
    expect(location.assigned).toEqual([]);
  });
});

describe('getSession and the authenticated fetch', () => {
  async function signedIn() {
    const env = setup({ href: CALLBACK });
    await env.auth.init();
    return { ...env, ps: env.oauth.sessions.get(ALICE)! };
  }

  it('returns null for accounts that are not signed in', async () => {
    const { auth } = await signedIn();
    expect(auth.getSession(BOB)).toBeNull();
  });

  it("sends requests on the account's own PDS through the session, as path + query", async () => {
    const { auth, ps } = await signedIn();
    const s = auth.getSession(ALICE)!;
    expect(s.info.did).toBe(ALICE);
    const res = await s.fetch(`${PDS}/xrpc/com.atproto.repo.describeRepo?repo=${encodeURIComponent(ALICE)}`, {
      headers: { accept: 'application/json' },
    });
    expect(res.status).toBe(200);
    expect(ps.handle).toHaveBeenCalledWith(
      `/xrpc/com.atproto.repo.describeRepo?repo=${encodeURIComponent(ALICE)}`,
      { headers: { accept: 'application/json' } },
    );
  });

  it('refuses any other origin and sends nothing', async () => {
    const { auth, ps } = await signedIn();
    const f = auth.getSession(ALICE)!.fetch;
    for (const url of ['https://public.api.bsky.app/xrpc/x', 'https://pds.fixture.test.evil.test/x', 'http://pds.fixture.test/x']) {
      await expect(f(url), url).rejects.toThrow(TypeError);
    }
    expect(ps.handle).not.toHaveBeenCalled();
  });

  it('signs the account out when a 401 turns out to be an expired session', async () => {
    const { auth, oauth, ps } = await signedIn();
    const seen: AuthState[] = [];
    auth.subscribe((s) => seen.push(s));
    vi.mocked(ps.handle).mockResolvedValueOnce(new Response('', { status: 401 }));
    oauth.isAlive.mockResolvedValueOnce(false);
    const res = await auth.getSession(ALICE)!.fetch(`${PDS}/xrpc/x`);
    expect(res.status).toBe(401);
    expect(auth.getState().status).toBe('signed-out');
    expect(seen.at(-1)!.issues.map((i) => [i.code, i.did])).toEqual([['session-expired', ALICE]]);
    expect(oauth.forget).toHaveBeenCalledWith(ALICE);
  });

  it('keeps the account on a 401 when the session is still alive', async () => {
    const { auth, ps } = await signedIn();
    vi.mocked(ps.handle).mockResolvedValueOnce(new Response('', { status: 401 }));
    await auth.getSession(ALICE)!.fetch(`${PDS}/xrpc/x`);
    expect(auth.getState().status).toBe('signed-in');
  });
});

describe('accounts: switching and signing out', () => {
  async function two() {
    const meta = {
      accounts: [
        { did: ALICE, handle: 'alice.fixture.test', signedInAt: '2025-12-01T00:00:00.000Z' },
        { did: BOB, handle: 'bob.fixture.test', signedInAt: '2025-12-02T00:00:00.000Z' },
      ],
      activeDid: ALICE,
    };
    const env = setup({ stored: [ALICE, BOB], meta });
    await env.auth.init();
    return env;
  }

  it('switches the active account and notifies subscribers', async () => {
    const { auth, storage } = await two();
    const seen: (string | null)[] = [];
    auth.subscribe((s) => seen.push(s.activeDid));
    expect(auth.setActive(BOB).activeDid).toBe(BOB);
    expect(auth.setActive('did:plc:fixture-nobody').activeDid).toBe(BOB);
    expect(seen).toEqual([BOB]);
    expect(JSON.parse(storage.data.get(META_KEY)!).activeDid).toBe(BOB);
  });

  it('signs one account out: revokes, forgets, removes it and moves the active account', async () => {
    const { auth, oauth } = await two();
    const s = await auth.signOut(ALICE);
    expect(oauth.signOut).toHaveBeenCalledWith(ALICE);
    expect(oauth.forget).toHaveBeenCalledWith(ALICE);
    expect(s.accounts.map((a) => a.did)).toEqual([BOB]);
    expect(s.activeDid).toBe(BOB);
    expect(s.issues).toEqual([]);
    expect(auth.getSession(ALICE)).toBeNull();
  });

  it('still signs out locally when the server cannot be reached', async () => {
    const { auth, oauth } = await two();
    oauth.signOut.mockRejectedValueOnce(new Classified('network', true));
    const s = await auth.signOut(ALICE);
    expect(s.accounts.map((a) => a.did)).toEqual([BOB]);
    expect(oauth.forget).toHaveBeenCalledWith(ALICE);
    expect(s.issues).toMatchObject([{ code: 'network', severity: 'warning', did: ALICE }]);
  });

  it('a fetch handed out before sign-out refuses to send anything afterwards', async () => {
    const { auth, oauth } = await two();
    const old = auth.getSession(ALICE)!;
    const ps = oauth.sessions.get(ALICE)!;
    await auth.signOut(ALICE);
    await expect(old.fetch(`${PDS}/xrpc/x`)).rejects.toThrow('no longer signed in');
    expect(ps.handle).not.toHaveBeenCalled();
    expect(auth.getState().accounts.map((a) => a.did)).toEqual([BOB]);
  });

  it('signs every account out and clears the saved list', async () => {
    const { auth, storage } = await two();
    const s = await auth.signOutAll();
    expect(s).toEqual({ schemaVersion: 1, status: 'signed-out', accounts: [], activeDid: null, issues: [] });
    expect(storage.data.has(META_KEY)).toBe(false);
  });

  it('drops an account signed out in another tab', async () => {
    const { auth, oauth, fireExternal } = await two();
    const seen: AuthState[] = [];
    auth.subscribe((s) => seen.push(s));
    oauth.stored.delete(ALICE);
    fireExternal();
    await tick();
    expect(auth.getState().accounts.map((a) => a.did)).toEqual([BOB]);
    expect(auth.getState().activeDid).toBe(BOB);
    expect(seen.at(-1)!.issues).toMatchObject([{ code: 'session-revoked', severity: 'info', did: ALICE }]);
  });

  it('picks up an account signed in from another tab', async () => {
    const { auth, oauth, fireExternal } = setup();
    await auth.init();
    oauth.stored.add(BOB);
    fireExternal();
    await tick();
    expect(auth.getState().accounts.map((a) => [a.did, a.handle])).toEqual([[BOB, 'bob.fixture.test']]);
    expect(auth.getState().activeDid).toBe(BOB);
  });
});

describe('state', () => {
  it('is plain JSON with no credentials or functions, and is a copy', async () => {
    const { auth } = setup({ href: CALLBACK });
    const s = await auth.init();
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);
    expect(JSON.stringify(s)).not.toMatch(/token|fetch|dpop/i);
    s.accounts.pop();
    expect(auth.getState().accounts).toHaveLength(1);
  });

  it('a throwing subscriber does not break auth or other subscribers', async () => {
    const { auth } = setup();
    const ok = vi.fn();
    auth.subscribe(() => {
      throw new Error('bad listener');
    });
    auth.subscribe(ok);
    await auth.init();
    expect(ok).toHaveBeenCalledTimes(1);
  });

  it('unsubscribe stops notifications', async () => {
    const { auth } = setup();
    const l = vi.fn();
    const off = auth.subscribe(l);
    off();
    await auth.init();
    expect(l).not.toHaveBeenCalled();
  });
});
