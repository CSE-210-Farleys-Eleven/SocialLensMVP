// Accounts: the signed-in account only (self-only for the MVP).
// Output: one AdapterRequest, ready for collect().
// Reads public data only. Never rejects: failures become issues.

import type { AccountsRegistryOutput, AdapterRequest, AuthInput, Issue, IssueCode, LoadOptions } from './contract';
import { buildRegistry, collectionsToRequest } from './registry';

const TIMEOUT_MS = 8000;

// ---------- errors in the adapters' issue format ----------

class IssueError extends Error {
  code: IssueCode;
  retryable: boolean;
  constructor(code: IssueCode, message: string, retryable: boolean) {
    super(message);
    this.code = code;
    this.retryable = retryable;
  }
}

function toIssue(e: unknown, severity: Issue['severity'], context: string): Issue {
  if (e instanceof IssueError) {
    return { source: 'registry', code: e.code, severity, message: `${context}: ${e.message}`, retryable: e.retryable };
  }
  return { source: 'registry', code: 'adapter-crashed', severity, message: `${context}: unexpected error`, retryable: false };
}

// ---------- network ----------

type Net = { f: typeof fetch; signal?: AbortSignal };

/** GET JSON. `what` is a user-safe description used in messages instead of the URL. */
async function getJSON<T>(url: string, what: string, net: Net): Promise<T> {
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), TIMEOUT_MS);
  const signal = net.signal ? AbortSignal.any([timeout.signal, net.signal]) : timeout.signal;
  try {
    let res: Response;
    try {
      res = await net.f(url, { signal });
    } catch {
      if (net.signal?.aborted) throw new IssueError('aborted', `request to ${what} was cancelled`, true);
      if (timeout.signal.aborted) throw new IssueError('timeout', `${what} timed out`, true);
      throw new IssueError('network', `could not reach ${what}`, true);
    }
    if (res.status === 429) throw new IssueError('rate-limited', `${what} is rate-limiting requests`, true);
    if (res.status === 404) throw new IssueError('not-found', `${what} not found`, false);
    if (res.status === 400) throw new IssueError('bad-request', `${what} rejected the request`, false);
    if (!res.ok) throw new IssueError('http-error', `${what} returned ${res.status}`, res.status >= 500);
    try {
      return (await res.json()) as T;
    } catch {
      throw new IssueError('bad-response', `${what} sent an unreadable response`, false);
    }
  } finally {
    clearTimeout(timer); // after the body is read, so the timeout covers it too
  }
}

/** XRPC URL with every parameter safely encoded. */
function xrpc(pds: string, method: string, params: Record<string, string | number>): string {
  const query = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]));
  return `${pds}/xrpc/${method}?${query}`;
}

/**
 * Same rule as the adapters: only public https origins.
 * Rejects http, credentials, localhost, .local, single-label hosts and IP literals.
 * Returns the origin (no trailing slash), or null if unsafe.
 */
function safeOrigin(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase();
  if (u.protocol !== 'https:' || u.username || u.password) return null;
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return null;
  if (!host.includes('.') || host.startsWith('[') || /^[\d.]+$/.test(host)) return null;
  return u.origin;
}

// ---------- AT Protocol reads (public, no credentials) ----------

async function getCollections(pdsUrl: string, did: string, net: Net): Promise<string[]> {
  const url = xrpc(pdsUrl, 'com.atproto.repo.describeRepo', { repo: did });
  const r = await getJSON<{ collections?: string[] }>(url, "the account's data server", net);
  return r.collections ?? [];
}

// ---------- building adapter requests ----------

/**
 * Build the AdapterRequest for one account.
 * - collections: the supported apps' collections, or undefined if we couldn't list the repo
 *   (the adapter then discovers them).
 * - session: the signed-in account's session. The adapter ignores a session for any other DID.
 */
function buildRequest(
  subject: AdapterRequest['subject'],
  collections: string[] | undefined,
  session: AdapterRequest['session'],
  options: AdapterRequest['options'],
): AdapterRequest {
  const req: AdapterRequest = { subject };
  if (collections) req.collections = collections;
  if (session) req.session = session;
  if (options) req.options = options;
  return req;
}

// ---------- main entry ----------

/**
 * Input: what auth/ provides. Output: the signed-in account with its apps and a ready AdapterRequest.
 * Requests: 1 (describeRepo on the signed-in account's data server).
 */
export async function loadAccounts(auth: AuthInput, opts: LoadOptions = {}): Promise<AccountsRegistryOutput> {
  const now = opts.now ?? (() => new Date());
  const net: Net = { f: opts.fetch ?? globalThis.fetch, signal: opts.signal };
  const start = now();
  const issues: Issue[] = [];
  const { info } = auth;

  let collections: string[] | undefined;
  const pdsUrl = safeOrigin(info.pdsUrl);
  if (!pdsUrl) {
    issues.push({
      source: 'registry', code: 'unsafe-url', severity: 'warning', retryable: false,
      message: "Your data server is not a public https address; the adapter will check it itself",
    });
  } else {
    try {
      collections = await getCollections(pdsUrl, info.did, net);
    } catch (e) {
      issues.push({
        ...toIssue(e, 'warning', "Couldn't list your apps"),
        message: "Couldn't list your apps; the adapter will discover collections itself",
      });
    }
  }

  const apps = collections ? buildRegistry(collections) : [];
  const self = {
    did: info.did,
    handle: info.handle,
    pdsUrl: info.pdsUrl,
    verification: 'self' as const,
    apps,
    request: buildRequest(
      // pdsUrl must be an https origin: send the checked origin, or leave it out if unsafe
      { did: info.did, handle: info.handle, ...(pdsUrl ? { pdsUrl } : {}) },
      collections ? collectionsToRequest(apps) : undefined,
      { did: info.did, ...(auth.fetch ? { fetch: auth.fetch } : {}) },
      opts.adapterOptions,
    ),
  };

  return {
    schemaVersion: 1,
    generatedAt: now().toISOString(),
    accounts: [self],
    issues,
    complete: collections !== undefined && !issues.some((i) => i.severity === 'error'),
    timingsMs: { total: now().getTime() - start.getTime() },
  };
}