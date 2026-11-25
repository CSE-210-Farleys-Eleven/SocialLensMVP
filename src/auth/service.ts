/**
 * Auth logic, independent of the OAuth library and the browser.
 * Everything from outside (OAuth client, URL, storage, clock) is injected.
 */
import { AUTH_SCHEMA_VERSION } from './contract';
import type {
  AuthIssue,
  AuthIssueCode,
  AuthListener,
  AuthService,
  AuthSession,
  AuthState,
  Did,
  SessionInfo,
} from './contract';
import type { OAuthPort, Phase, PortSession } from './port';

/** Read-only: identity only, no repo-write or transitional scopes. */
export const DEFAULT_SCOPE = 'atproto';
/** localStorage key for auth's own small record (DIDs, handles, active account). */
export const META_KEY = 'sociallens-auth:v1';

export interface AuthLocation {
  /** Current page URL. */
  href(): string;
  /** Replace the current URL without navigating (scrubs OAuth params). */
  replace(url: string): void;
  /** Navigate to a URL (the provider). */
  assign(url: string): void;
}

export type AuthStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export interface AuthDeps {
  oauth: OAuthPort;
  location: AuthLocation;
  /** Where auth keeps its account list. null: accounts are not remembered across reloads. */
  storage: AuthStorage | null;
  now?: () => Date;
  scope?: string;
  /**
   * Called with a callback to run when another tab changes the stored
   * sessions. Returns an unsubscribe function.
   */
  watchExternal?: (onChange: () => void) => () => void;
}

interface Meta {
  accounts: { did: string; handle: string; signedInAt: string }[];
  activeDid: string | null;
}

interface Live {
  info: SessionInfo;
  fetch: typeof fetch;
}

const MESSAGES: Record<AuthIssueCode, string> = {
  'invalid-handle': 'Enter a handle like alice.bsky.social or a DID.',
  'resolution-failed': 'Could not find that account or its sign-in server.',
  cancelled: 'Sign-in was cancelled.',
  'callback-failed': 'Sign-in could not be completed. Please try again.',
  'session-expired': 'Your session has expired. Please sign in again.',
  'session-revoked': 'This account was signed out.',
  'storage-unavailable': 'This browser is blocking the storage sign-in needs (for example, private browsing).',
  network: 'Could not reach the sign-in server. Check your connection.',
  timeout: 'The sign-in server took too long to respond.',
  unexpected: 'Something went wrong with sign-in.',
};

/** Accepts `alice.bsky.social`, `@alice.bsky.social` or a did:plc / did:web. */
export function normalizeIdentifier(input: string): string | null {
  const s = input.trim().replace(/^@/, '');
  if (/^did:(plc|web):[a-zA-Z0-9._:%-]+$/.test(s)) return s;
  const handle = s.toLowerCase();
  if (handle.length > 253) return null;
  const label = '[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?';
  return new RegExp(`^(${label}\\.)+[a-z]([a-z0-9-]{0,61}[a-z0-9])?$`).test(handle) ? handle : null;
}

/** OAuth redirect parameters (in the URL fragment), or null if this is not a callback. */
function callbackParams(href: string): URLSearchParams | null {
  const hash = new URL(href).hash.slice(1);
  if (!hash) return null;
  const p = new URLSearchParams(hash);
  return p.has('state') && (p.has('code') || p.has('error')) ? p : null;
}

function withoutHash(href: string): string {
  const u = new URL(href);
  u.hash = '';
  return u.href;
}

/**
 * The auth service, with the OAuth client, URL, storage and clock injected.
 * NEVER rejects for expected failures: they come back as issues in the state.
 * Holds live sessions in memory; only the account list is written to `storage`.
 */
export function createAuth(deps: AuthDeps): AuthService {
  const { oauth, location, storage } = deps;
  const now = deps.now ?? (() => new Date());
  const scope = deps.scope ?? DEFAULT_SCOPE;

  const live = new Map<string, Live>();
  let order: string[] = []; // sign-in order of `live`
  let activeDid: string | null = null;
  let issues: AuthIssue[] = [];
  let initPromise: Promise<AuthState> | null = null;
  const listeners = new Set<AuthListener>();

  // Internal helpers.

  function mkIssue(code: AuthIssueCode, severity: AuthIssue['severity'], retryable: boolean, did?: string): AuthIssue {
    return { source: 'auth', code, severity, message: MESSAGES[code], retryable, ...(did ? { did } : {}) };
  }

  function issueFrom(err: unknown, phase: Phase, severity: AuthIssue['severity'], did?: string): AuthIssue {
    let c: { code: AuthIssueCode; retryable: boolean };
    try {
      c = oauth.classify(err, phase);
    } catch {
      c = { code: 'unexpected', retryable: false };
    }
    // Never forward the library's message: it may contain URLs.
    return mkIssue(c.code, severity, c.retryable, did);
  }

  function snapshot(): AuthState {
    const accounts = order.map((d) => live.get(d)!.info);
    return JSON.parse(
      JSON.stringify({
        schemaVersion: AUTH_SCHEMA_VERSION,
        status: accounts.length ? 'signed-in' : 'signed-out',
        accounts,
        activeDid,
        issues,
      }),
    ) as AuthState;
  }

  function emit(): AuthState {
    const s = snapshot();
    for (const l of listeners) {
      try {
        l(snapshot());
      } catch {
        // A broken listener must not break auth or the other listeners.
      }
    }
    return s;
  }

  function loadMeta(): Meta {
    try {
      const raw = storage?.getItem(META_KEY);
      const m = raw ? (JSON.parse(raw) as Partial<Meta>) : null;
      const accounts = Array.isArray(m?.accounts)
        ? m.accounts.filter(
            (a): a is Meta['accounts'][number] =>
              !!a && typeof a.did === 'string' && typeof a.handle === 'string' && typeof a.signedInAt === 'string',
          )
        : [];
      return { accounts, activeDid: typeof m?.activeDid === 'string' ? m.activeDid : null };
    } catch {
      return { accounts: [], activeDid: null };
    }
  }

  function saveMeta() {
    if (!storage) return;
    const meta: Meta = {
      accounts: order.map((d) => {
        const i = live.get(d)!.info;
        return { did: i.did, handle: i.handle, signedInAt: i.signedInAt };
      }),
      activeDid,
    };
    try {
      if (meta.accounts.length) storage.setItem(META_KEY, JSON.stringify(meta));
      else storage.removeItem(META_KEY);
    } catch {
      // Not fatal: the sessions still work until reload.
    }
  }

  function sessionFetch(ps: PortSession): typeof fetch {
    const origin = new URL(ps.pdsUrl).origin;
    const f: typeof fetch = async (input, init) => {
      // A fetch handed out earlier dies with its session (sign-out, expiry, re-sign-in).
      if (live.get(ps.did)?.fetch !== f) {
        throw new TypeError('This account is no longer signed in.');
      }
      const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const url = new URL(raw);
      if (url.origin !== origin) {
        throw new TypeError("This session can only send requests to the account's own data server.");
      }
      let opts = init;
      if (typeof input !== 'string' && !(input instanceof URL)) {
        opts = { method: input.method, headers: input.headers, signal: input.signal, ...init };
      }
      const res = await ps.handle(url.pathname + url.search, opts);
      if (res.status === 401 && live.has(ps.did) && !(await oauth.isAlive(ps.did).catch(() => true))) {
        drop(ps.did, mkIssue('session-expired', 'warning', false, ps.did));
      }
      return res;
    };
    return f;
  }

  function add(ps: PortSession, handle: string, signedInAt: string) {
    const info: SessionInfo = {
      status: 'signed-in',
      did: ps.did,
      handle,
      pdsUrl: ps.pdsUrl,
      authServer: ps.authServer,
      scopes: [...ps.scopes],
      signedInAt,
    };
    live.set(ps.did, { info, fetch: sessionFetch(ps) });
    if (!order.includes(ps.did)) order.push(ps.did);
  }

  function remove(did: string) {
    live.delete(did);
    order = order.filter((d) => d !== did);
    if (activeDid === did) activeDid = order[0] ?? null;
  }

  /** Remove an account whose session ended without a sign-out here (expired or revoked). */
  function drop(did: string, why: AuthIssue) {
    if (!live.has(did)) return;
    oauth.forget(did);
    remove(did);
    issues = [why];
    saveMeta();
    emit();
  }

  async function restoreInto(dids: string[], meta: Meta, found: AuthIssue[]) {
    for (const did of dids) {
      if (live.has(did)) continue;
      try {
        const ps = await oauth.restore(did);
        if (ps.did !== did) throw new Error('session subject mismatch');
        const m = meta.accounts.find((a) => a.did === did);
        add(ps, m?.handle ?? (await oauth.resolveHandle(did)) ?? did, m?.signedInAt ?? now().toISOString());
      } catch (err) {
        const iss = issueFrom(err, 'restore', 'warning', did);
        found.push(iss);
        if (!iss.retryable) oauth.forget(did);
      }
    }
  }

  // The AuthService methods.

  async function doInit(): Promise<AuthState> {
    const found: AuthIssue[] = [];
    const meta = loadMeta();
    let newDid: string | null = null;

    let href: string | null = null;
    try {
      href = location.href();
    } catch {
      href = null;
    }
    const params = href ? callbackParams(href) : null;
    if (params && href) {
      // Scrub the code/state first so a reload or shared link can't replay it.
      try {
        location.replace(withoutHash(href));
      } catch {
        // Best-effort: the library deletes the state on use, so the code cannot be exchanged twice anyway.
      }
      try {
        const ps = await oauth.finalize(params);
        const handle = (await oauth.resolveHandle(ps.did)) ?? ps.did;
        // Re-signing into an account already present refreshes its info.
        remove(ps.did);
        add(ps, handle, now().toISOString());
        newDid = ps.did;
      } catch (err) {
        found.push(issueFrom(err, 'callback', 'error'));
      }
    }

    // Accounts we already knew, in their original order, then any others the library holds.
    const stored = new Set(oauth.storedDids());
    const known = meta.accounts.map((a) => a.did).filter((d) => stored.has(d));
    await restoreInto([...known, ...[...stored].filter((d) => !known.includes(d))], meta, found);
    // Keep sign-in order: previously known accounts first, the new one last.
    if (newDid) order = [...order.filter((d) => d !== newDid), newDid];

    activeDid =
      newDid ?? (meta.activeDid && live.has(meta.activeDid) ? meta.activeDid : null) ?? order[0] ?? null;
    issues = found;
    saveMeta();

    deps.watchExternal?.(() => {
      void sync();
    });
    return emit();
  }

  /** Reconcile with sessions changed by another tab. */
  async function sync() {
    const stored = new Set(oauth.storedDids());
    const gone = order.filter((d) => !stored.has(d));
    const added = [...stored].filter((d) => !live.has(d));
    if (!gone.length && !added.length) return;
    const found: AuthIssue[] = [];
    for (const d of gone) {
      remove(d);
      found.push(mkIssue('session-revoked', 'info', false, d));
    }
    await restoreInto(added, loadMeta(), found);
    if (!activeDid) activeDid = order[0] ?? null;
    issues = found;
    saveMeta();
    emit();
  }

  const service: AuthService = {
    init() {
      initPromise ??= doInit().catch(() => {
        issues = [mkIssue('unexpected', 'error', true)];
        return emit();
      });
      return initPromise;
    },

    async signIn(handleOrDid) {
      const id = normalizeIdentifier(handleOrDid);
      let result: AuthIssue | null = null;
      if (!id) {
        result = mkIssue('invalid-handle', 'error', false);
      } else {
        try {
          const url = await oauth.authorizationUrl(id, scope);
          location.assign(url);
        } catch (err) {
          result = issueFrom(err, 'sign-in', 'error');
        }
      }
      issues = result ? [result] : [];
      emit();
      return result;
    },

    getState: snapshot,

    getSession(did: Did): AuthSession | null {
      const l = live.get(did);
      return l ? { info: { ...l.info, scopes: [...l.info.scopes] }, fetch: l.fetch } : null;
    },

    setActive(did) {
      if (live.has(did) && activeDid !== did) {
        activeDid = did;
        issues = [];
        saveMeta();
        return emit();
      }
      return snapshot();
    },

    async signOut(did) {
      if (!live.has(did)) return snapshot();
      const found: AuthIssue[] = [];
      // Remove locally first, so nothing can use the session while revoking.
      remove(did);
      saveMeta();
      try {
        await oauth.signOut(did);
      } catch (err) {
        const c = issueFrom(err, 'sign-out', 'warning', did);
        found.push({ ...c, message: 'Signed out on this device, but the server could not be told to end the session.' });
      } finally {
        oauth.forget(did);
      }
      issues = found;
      return emit();
    },

    async signOutAll() {
      const dids = [...order];
      const found: AuthIssue[] = [];
      for (const d of dids) {
        await service.signOut(d);
        found.push(...issues);
      }
      issues = found;
      return emit();
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
  return service;
}
