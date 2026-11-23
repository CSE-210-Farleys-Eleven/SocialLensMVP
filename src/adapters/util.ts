import type { AdapterIssue, IssueCode } from './contract';

/** Run `fn` over `items` with at most `limit` in flight. Preserves order. */
export async function mapPool<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i] as T, i);
    }
  });
  await Promise.all(workers);
  return out;
}

export function issue(
  source: AdapterIssue['source'],
  code: IssueCode,
  severity: AdapterIssue['severity'],
  message: string,
  extra: Partial<Pick<AdapterIssue, 'retryable' | 'collection' | 'httpStatus'>> = {},
): AdapterIssue {
  return { source, code, severity, message, retryable: extra.retryable ?? false, ...extra };
}

export const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

export const asString = (v: unknown): string | null => (typeof v === 'string' ? v : null);
export const asCount = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null;

export function chunk<T>(arr: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/** Split `at://did/collection/rkey`. Returns null if malformed. */
export function parseAtUri(uri: string): { did: string; collection: string; rkey: string } | null {
  const m = /^at:\/\/([^/]+)\/([^/]+)\/([^/]+)$/.exec(uri);
  return m ? { did: m[1]!, collection: m[2]!, rkey: m[3]! } : null;
}
