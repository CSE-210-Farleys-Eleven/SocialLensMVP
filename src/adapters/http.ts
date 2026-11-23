import type { AdapterContext, AdapterIssue, SourceId } from './contract';
import { isRecord, issue } from './util';

export type HttpResult<T = unknown> =
  | { ok: true; value: T; status: number }
  | { ok: false; issue: AdapterIssue };

export interface GetJsonOptions {
  source: SourceId;
  /** Override fetch (authenticated session fetch). */
  fetch?: typeof fetch;
  headers?: Record<string, string>;
  /** Used in error messages instead of the full URL. */
  label: string;
  collection?: string;
}

/**
 * GET + JSON with timeout, retry (timeout/network/5xx/429), Retry-After
 * handling, and caller abort. NEVER throws: failures come back as an issue.
 */
export async function getJson<T = unknown>(
  ctx: AdapterContext,
  url: string,
  opts: GetJsonOptions,
): Promise<HttpResult<T>> {
  const doFetch = opts.fetch ?? ctx.fetch;
  const extra = opts.collection ? { collection: opts.collection } : {};
  let last: AdapterIssue | null = null;

  for (let attempt = 0; attempt <= ctx.maxRetries; attempt++) {
    if (ctx.signal?.aborted) {
      return fail(issue(opts.source, 'aborted', 'warning', `${opts.label}: cancelled.`, extra));
    }
    const timeout = AbortSignal.timeout(ctx.timeoutMs);
    const signal = ctx.signal ? AbortSignal.any([ctx.signal, timeout]) : timeout;

    let res: Response;
    try {
      res = await doFetch(url, { headers: { accept: 'application/json', ...opts.headers }, signal });
    } catch {
      if (ctx.signal?.aborted) {
        return fail(issue(opts.source, 'aborted', 'warning', `${opts.label}: cancelled.`, extra));
      }
      last = timeout.aborted
        ? issue(opts.source, 'timeout', 'error', `${opts.label}: timed out after ${ctx.timeoutMs} ms.`, { retryable: true, ...extra })
        : issue(opts.source, 'network', 'error', `${opts.label}: network error.`, { retryable: true, ...extra });
      await ctx.sleep(backoff(attempt), ctx.signal);
      continue;
    }

    if (res.ok) {
      try {
        return { ok: true, value: (await res.json()) as T, status: res.status };
      } catch {
        return fail(issue(opts.source, 'bad-response', 'error', `${opts.label}: response was not valid JSON.`, { httpStatus: res.status, ...extra }));
      }
    }

    const detail = await xrpcDetail(res);
    const status = res.status;

    if (status === 429) {
      const wait = retryAfterMs(res, ctx.now());
      last = issue(opts.source, 'rate-limited', 'error', `${opts.label}: rate limited by the server.`, { retryable: true, httpStatus: status, ...extra });
      if (wait === null || wait > ctx.maxRetryAfterMs) return fail(last);
      await ctx.sleep(wait, ctx.signal);
      continue;
    }
    if (status >= 500) {
      last = issue(opts.source, 'http-error', 'error', `${opts.label}: server error ${status}.`, { retryable: true, httpStatus: status, ...extra });
      await ctx.sleep(backoff(attempt), ctx.signal);
      continue;
    }
    if (status === 404) return fail(issue(opts.source, 'not-found', 'error', `${opts.label}: not found.`, { httpStatus: status, ...extra }));
    if (status === 401 || status === 403) return fail(issue(opts.source, 'auth-required', 'error', `${opts.label}: access denied (${status}).`, { httpStatus: status, ...extra }));
    if (status === 400) {
      // XRPC reports e.g. RepoNotFound as 400 with an error name.
      const code = detail === 'RepoNotFound' || detail === 'RepoTakendown' || detail === 'RepoDeactivated' ? 'not-found' : 'bad-request';
      return fail(issue(opts.source, code, 'error', `${opts.label}: ${detail ?? 'request rejected'}.`, { httpStatus: status, ...extra }));
    }
    return fail(issue(opts.source, 'http-error', 'error', `${opts.label}: unexpected status ${status}.`, { httpStatus: status, ...extra }));
  }
  return fail(last ?? issue(opts.source, 'network', 'error', `${opts.label}: failed.`, { retryable: true, ...extra }));
}

function fail<T>(i: AdapterIssue): HttpResult<T> {
  return { ok: false, issue: i };
}

function backoff(attempt: number): number {
  return 250 * 2 ** attempt;
}

/** Retry-After as seconds or HTTP date -> ms. null if absent/unparseable. */
function retryAfterMs(res: Response, now: Date): number | null {
  const h = res.headers.get('retry-after');
  if (h === null) return null;
  const secs = Number(h);
  if (Number.isFinite(secs) && secs >= 0) return secs * 1000;
  const date = Date.parse(h);
  return Number.isNaN(date) ? null : Math.max(0, date - now.getTime());
}

async function xrpcDetail(res: Response): Promise<string | null> {
  try {
    const body: unknown = await res.json();
    return isRecord(body) && typeof body.error === 'string' ? body.error : null;
  } catch {
    return null;
  }
}

/**
 * Validate a service origin (a PDS URL from a DID document is untrusted
 * input). Returns the bare origin, or null if unsafe: must be https, no
 * credentials/path/query, and not localhost / IP literal / .local / .internal
 * unless `ctx.allowInsecureHosts`.
 */
export function safeServiceOrigin(raw: unknown, ctx: Pick<AdapterContext, 'allowInsecureHosts'>): string | null {
  if (typeof raw !== 'string') return null;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.username || u.password || u.search || u.hash || u.pathname !== '/') return null;
  if (ctx.allowInsecureHosts) return u.protocol === 'https:' || u.protocol === 'http:' ? u.origin : null;
  if (u.protocol !== 'https:') return null;
  const host = u.hostname.toLowerCase();
  const isIp = /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':') || host.startsWith('[');
  if (isIp || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal') || !host.includes('.')) {
    return null;
  }
  return u.origin;
}
