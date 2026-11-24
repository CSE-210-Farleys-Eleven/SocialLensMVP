// Accounts: the signed-in account, its linked accounts, and mutual verification.
// Output: one AdapterRequest per usable account, ready for collect().
// Reads public data only. Never rejects: failures become issues.

import { buildRegistry, collectionsToRequest } from "./registry";
import type {
  AccountEntry,
  AccountsRegistryOutput,
  AdapterRequest,
  AuthInput,
  Issue,
  IssueCode,
} from "./types";

export const LINK_COLLECTION = "app.sociallens.linkedAccount";
const PLC = "https://plc.directory";
const MAX_LINKED = 10;   // linked accounts we load at most
const CONCURRENCY = 4;   // linked accounts loaded in parallel
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

function toIssue(e: unknown, severity: Issue["severity"], context: string): Issue {
  if (e instanceof IssueError) {
    return { source: "registry", code: e.code, severity, message: `${context}: ${e.message}`, retryable: e.retryable };
  }
  return { source: "registry", code: "adapter-crashed", severity, message: `${context}: unexpected error`, retryable: false };
}

/** GET JSON. `what` is a user-safe description used in messages instead of the URL. */
async function getJSON<T>(url: string, what: string, f: typeof fetch): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    res = await f(url, { signal: ctrl.signal });
  } catch {
    throw ctrl.signal.aborted
      ? new IssueError("timeout", `${what} timed out`, true)
      : new IssueError("network", `could not reach ${what}`, true);
  } finally {
    clearTimeout(timer);
  }
  if (res.status === 429) throw new IssueError("rate-limited", `${what} is rate-limiting requests`, true);
  if (res.status === 404) throw new IssueError("not-found", `${what} not found`, false);
  if (res.status === 400) throw new IssueError("bad-request", `${what} rejected the request`, false);
  if (!res.ok) throw new IssueError("http-error", `${what} returned ${res.status}`, res.status >= 500);
  try {
    return (await res.json()) as T;
  } catch {
    throw new IssueError("bad-response", `${what} sent an unreadable response`, false);
  }
}

/** XRPC URL with every parameter safely encoded. */
function xrpc(pds: string, method: string, params: Record<string, string | number>): string {
  const query = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]));
  return `${pds}/xrpc/${method}?${query}`;
}

/** A missing record or collection (404/400) means "use the fallback"; other failures still throw. */
async function orIfMissing<T>(promise: Promise<T>, fallback: T): Promise<T> {
  try {
    return await promise;
  } catch (e) {
    if (e instanceof IssueError && (e.code === "not-found" || e.code === "bad-request")) return fallback;
    throw e;
  }
}

/** Run tasks with at most `limit` in flight. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  const queue = items.map((item, index) => ({ item, index }));
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (let job = queue.shift(); job; job = queue.shift()) {
      out[job.index] = await fn(job.item);
    }
  });
  await Promise.all(workers);
  return out;
}

// ---------- AT Protocol reads (public, no credentials) ----------

type DidDoc = {
  alsoKnownAs?: string[];
  service?: { id: string; type: string; serviceEndpoint: string }[];
};

/** DID -> handle + data server URL. */
async function resolveDid(did: string, f: typeof fetch): Promise<{ handle: string; pdsUrl: string }> {
  let doc: DidDoc;
  if (did.startsWith("did:plc:")) doc = await getJSON<DidDoc>(`${PLC}/${did}`, "the PLC directory", f);
  else if (did.startsWith("did:web:"))
    doc = await getJSON<DidDoc>(`https://${did.slice(8)}/.well-known/did.json`, "the account's DID host", f);
  else if (did.startsWith("did:")) throw new IssueError("unsupported-did-method", "unsupported DID method", false);
  else throw new IssueError("invalid-did", "not a valid DID", false);

  const pds = doc.service?.find((s) => s.id.endsWith("#atproto_pds"))?.serviceEndpoint;
  if (!pds) throw new IssueError("bad-response", "the DID document lists no data server", false);
  const handle = doc.alsoKnownAs?.[0]?.replace("at://", "") ?? did;
  return { handle, pdsUrl: pds.replace(/\/$/, "") };
}

async function getCollections(pdsUrl: string, did: string, f: typeof fetch): Promise<string[]> {
  const url = xrpc(pdsUrl, "com.atproto.repo.describeRepo", { repo: did });
  const r = await getJSON<{ collections?: string[] }>(url, "the account's data server", f);
  return r.collections ?? [];
}

/** DIDs this account says it's linked to. A missing collection means "no links", not an error. */
async function getLinkedDids(pdsUrl: string, did: string, f: typeof fetch): Promise<string[]> {
  const url = xrpc(pdsUrl, "com.atproto.repo.listRecords", { repo: did, collection: LINK_COLLECTION, limit: MAX_LINKED });
  type Page = { records?: { value?: { did?: string } }[] };
  const r = await orIfMissing(getJSON<Page>(url, "the account's data server", f), { records: [] });
  return [...new Set((r.records ?? []).map((x) => x.value?.did).filter((d): d is string => !!d))];
}

/** Does `otherDid` link back to `selfDid`? Record key = the linked DID, so one direct lookup. */
async function linksBack(otherPds: string, otherDid: string, selfDid: string, f: typeof fetch): Promise<boolean> {
  const url = xrpc(otherPds, "com.atproto.repo.getRecord", { repo: otherDid, collection: LINK_COLLECTION, rkey: selfDid });
  return orIfMissing(getJSON(url, "the linked account's data server", f).then(() => true), false);
}

// ---------- building adapter requests ----------

/**
 * Build the AdapterRequest for one account.
 * - collections: the supported apps' collections, or undefined if
 *   we didn't list the repo ourselves.
 * - session: pass it only for the signed-in account. The adapter ignores a session for any
 *   other DID, and public reads need none.
 */
function buildRequest(
  subject: { did: string; handle: string; pdsUrl: string },
  collections: string[] | undefined,
  session: AdapterRequest["session"],
  options: AdapterRequest["options"],
): AdapterRequest {
  const req: AdapterRequest = { subject };
  if (collections) req.collections = collections;
  if (session) req.session = session;
  if (options) req.options = options;
  return req;
}

// ---------- main entry ----------

export type LoadOptions = {
  adapterOptions?: AdapterRequest["options"]; // copied into every request
  fetch?: typeof fetch;                       // for tests; defaults to global fetch
};

/**
 * Input: what auth/ provides. Output: every usable account with its apps and a ready AdapterRequest.
 * Requests: 2 for the signed-in account, then 3 per linked account (resolve, link-back, describe),
 * with up to 4 linked accounts in flight.
 */
export async function loadAccounts(auth: AuthInput, opts: LoadOptions = {}): Promise<AccountsRegistryOutput> {
  const f = opts.fetch ?? globalThis.fetch;
  const issues: Issue[] = [];
  const timings: Record<string, number> = {};
  const t0 = performance.now();
  const { info } = auth;
  let skipped = 0;

  // Signed-in account: list collections and links in parallel.
  const tSelf = performance.now();
  const [colsResult, linksResult] = await Promise.allSettled([
    getCollections(info.pdsUrl, info.did, f),
    getLinkedDids(info.pdsUrl, info.did, f),
  ]);
  timings.self = Math.round(performance.now() - tSelf);

  let selfCollections: string[] | undefined;
  if (colsResult.status === "fulfilled") selfCollections = colsResult.value;
  else {
    issues.push({
      ...toIssue(colsResult.reason, "warning", "Couldn't list your apps"),
      message: "Couldn't list your apps; the adapter will discover collections itself",
    });
  }

  let linkedDids: string[] = [];
  if (linksResult.status === "fulfilled") linkedDids = linksResult.value.filter((d) => d !== info.did);
  else issues.push(toIssue(linksResult.reason, "warning", "Couldn't read your linked accounts"));

  const selfApps = selfCollections ? buildRegistry(selfCollections) : [];
  const self: AccountEntry = {
    did: info.did,
    handle: info.handle,
    pdsUrl: info.pdsUrl,
    verification: "self",
    apps: selfApps,
    request: buildRequest(
      { did: info.did, handle: info.handle, pdsUrl: info.pdsUrl },
      selfCollections ? collectionsToRequest(selfApps) : undefined,
      { did: info.did, ...(auth.fetch ? { fetch: auth.fetch } : {}) },
      opts.adapterOptions,
    ),
  };

  // Linked accounts: resolve, verify, list apps.
  const tLinked = performance.now();
  const linked = await mapLimit(linkedDids, CONCURRENCY, async (did): Promise<AccountEntry | null> => {
    try {
      const { handle, pdsUrl } = await resolveDid(did, f);
      const [back, cols] = await Promise.all([
        linksBack(pdsUrl, did, info.did, f),
        getCollections(pdsUrl, did, f),
      ]);
      if (!back) {
        // Pending: listed so the user can finish linking, but no apps and no request.
        return { did, handle, pdsUrl, verification: "pending", apps: [], request: null };
      }
      const apps = buildRegistry(cols);
      return {
        did, handle, pdsUrl, verification: "verified", apps,
        request: buildRequest({ did, handle, pdsUrl }, collectionsToRequest(apps), undefined, opts.adapterOptions),
      };
    } catch (e) {
      skipped++;
      issues.push(toIssue(e, "warning", "Skipped a linked account"));
      return null;
    }
  });
  timings.linked = Math.round(performance.now() - tLinked);
  timings.total = Math.round(performance.now() - t0);

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    accounts: [self, ...linked.filter((a): a is AccountEntry => a !== null)],
    issues,
    complete: skipped === 0 && !issues.some((i) => i.severity === "error") && selfCollections !== undefined,
    timingsMs: timings,
  };
}