import type { AdapterContext } from './contract';

/** Abortable sleep. Resolves early (does not reject) if `signal` aborts. */
export function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const t = setTimeout(done, ms);
    function done() {
      clearTimeout(t);
      signal?.removeEventListener('abort', done);
      resolve();
    }
    signal?.addEventListener('abort', done, { once: true });
  });
}

/** Build a context with production defaults. Any field can be overridden. */
export function createContext(overrides: Partial<AdapterContext> = {}): AdapterContext {
  return {
    fetch: overrides.fetch ?? ((...a: Parameters<typeof fetch>) => globalThis.fetch(...a)),
    signal: overrides.signal,
    now: overrides.now ?? (() => new Date()),
    endpoints: {
      plcDirectory: 'https://plc.directory',
      appView: 'https://public.api.bsky.app',
      ...overrides.endpoints,
    },
    timeoutMs: overrides.timeoutMs ?? 10_000,
    maxRetries: overrides.maxRetries ?? 2,
    maxRetryAfterMs: overrides.maxRetryAfterMs ?? 5_000,
    sleep: overrides.sleep ?? defaultSleep,
    allowInsecureHosts: overrides.allowInsecureHosts ?? false,
  };
}
