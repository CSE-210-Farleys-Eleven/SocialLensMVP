import { describe, expect, it, vi } from 'vitest';
import { createContext } from './context';
import { getJson, safeServiceOrigin } from './http';

const noSleep = vi.fn(async () => {});
const ctxWith = (f: typeof fetch, extra = {}) => createContext({ fetch: f, sleep: noSleep, ...extra });
const opts = { source: 'atproto' as const, label: 'test' };
const res = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers });

describe('getJson', () => {
  it('returns parsed JSON on 200', async () => {
    const r = await getJson(ctxWith(async () => res({ a: 1 })), 'https://x.test/', opts);
    expect(r).toMatchObject({ ok: true, value: { a: 1 } });
  });

  it('retries 5xx then succeeds', async () => {
    const f = vi.fn().mockResolvedValueOnce(res({}, 503)).mockResolvedValueOnce(res({ ok: 1 }));
    const r = await getJson(ctxWith(f as unknown as typeof fetch), 'https://x.test/', opts);
    expect(r.ok).toBe(true);
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('gives up after maxRetries and reports a retryable http-error', async () => {
    const f = vi.fn(async () => res({}, 500));
    const r = await getJson(ctxWith(f as unknown as typeof fetch, { maxRetries: 2 }), 'https://x.test/', opts);
    expect(f).toHaveBeenCalledTimes(3);
    expect(r).toMatchObject({ ok: false, issue: { code: 'http-error', retryable: true } });
  });

  it('waits for a short Retry-After on 429, then succeeds', async () => {
    const f = vi.fn().mockResolvedValueOnce(res({}, 429, { 'retry-after': '2' })).mockResolvedValueOnce(res({ v: 1 }));
    const sleep = vi.fn(async () => {});
    const r = await getJson(ctxWith(f as unknown as typeof fetch, { sleep }), 'https://x.test/', opts);
    expect(r.ok).toBe(true);
    expect(sleep).toHaveBeenCalledWith(2000, undefined);
  });

  it('does not wait for a Retry-After above the cap', async () => {
    const f = vi.fn(async () => res({}, 429, { 'retry-after': '3600' }));
    const sleep = vi.fn(async () => {});
    const r = await getJson(ctxWith(f as unknown as typeof fetch, { sleep }), 'https://x.test/', opts);
    expect(f).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
    expect(r).toMatchObject({ ok: false, issue: { code: 'rate-limited', retryable: true, httpStatus: 429 } });
  });

  it('maps 404, 401 and XRPC RepoNotFound', async () => {
    const code = async (status: number, body: unknown = {}) => {
      const r = await getJson(ctxWith(async () => res(body, status)), 'https://x.test/', opts);
      return r.ok ? 'ok' : r.issue.code;
    };
    expect(await code(404)).toBe('not-found');
    expect(await code(401)).toBe('auth-required');
    expect(await code(400, { error: 'RepoNotFound' })).toBe('not-found');
    expect(await code(400, { error: 'InvalidRequest' })).toBe('bad-request');
  });

  it('reports invalid JSON as bad-response', async () => {
    const r = await getJson(ctxWith(async () => new Response('<html>', { status: 200 })), 'https://x.test/', opts);
    expect(r).toMatchObject({ ok: false, issue: { code: 'bad-response' } });
  });

  it('reports network errors as retryable and never throws', async () => {
    const r = await getJson(
      ctxWith(async () => {
        throw new TypeError('boom');
      }),
      'https://x.test/',
      opts,
    );
    expect(r).toMatchObject({ ok: false, issue: { code: 'network', retryable: true } });
  });

  it('reports a hung request as timeout', async () => {
    const hang = ((_u: unknown, init?: RequestInit) =>
      new Promise((_r, rej) => init?.signal?.addEventListener('abort', () => rej(new Error('aborted'))))) as typeof fetch;
    const r = await getJson(ctxWith(hang, { timeoutMs: 20, maxRetries: 0 }), 'https://x.test/', opts);
    expect(r).toMatchObject({ ok: false, issue: { code: 'timeout' } });
  });

  it('stops immediately when the caller aborts, without retrying', async () => {
    const ac = new AbortController();
    const f = vi.fn(async (_u: unknown, init?: RequestInit) => {
      ac.abort();
      if (init?.signal?.aborted) throw new Error('aborted');
      return res({});
    });
    const r = await getJson(ctxWith(f as unknown as typeof fetch, { signal: ac.signal }), 'https://x.test/', opts);
    expect(f).toHaveBeenCalledTimes(1);
    expect(r).toMatchObject({ ok: false, issue: { code: 'aborted' } });
  });

  it('does not leak the full URL (which may carry a DID) into issue messages beyond the label', async () => {
    const r = await getJson(ctxWith(async () => res({}, 404)), 'https://x.test/secret-path?token=abc', opts);
    expect(JSON.stringify(r)).not.toContain('token=abc');
  });
});

describe('safeServiceOrigin', () => {
  const strict = { allowInsecureHosts: false };
  it('accepts a public https origin', () => {
    expect(safeServiceOrigin('https://pds.example.com/', strict)).toBe('https://pds.example.com');
    expect(safeServiceOrigin('https://pds.example.com', strict)).toBe('https://pds.example.com');
  });
  it.each([
    'http://pds.example.com',
    'https://localhost',
    'https://127.0.0.1',
    'https://[::1]',
    'https://10.0.0.5',
    'https://pds.local',
    'https://svc.internal',
    'https://intranet',
    'https://user:pw@pds.example.com',
    'https://pds.example.com/path',
    'https://pds.example.com/?q=1',
    'javascript:alert(1)',
    'not a url',
  ])('rejects %s', (u) => expect(safeServiceOrigin(u, strict)).toBeNull());
  it('rejects non-strings', () => {
    expect(safeServiceOrigin(null, strict)).toBeNull();
    expect(safeServiceOrigin(42, strict)).toBeNull();
  });
  it('allows http/localhost only when explicitly insecure', () => {
    expect(safeServiceOrigin('http://localhost:2583', { allowInsecureHosts: true })).toBe('http://localhost:2583');
  });
});
