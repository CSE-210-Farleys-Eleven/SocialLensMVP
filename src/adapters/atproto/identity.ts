import type { AdapterContext, AdapterIssue, AdapterRequest, IdentityItem } from '../contract';
import { getJson, safeServiceOrigin } from '../http';
import { asString, isRecord, issue } from '../util';

const SRC = 'atproto' as const;
const DID_PLC = /^did:plc:[a-z2-7]{24}$/;
const DID_WEB = /^did:web:[a-zA-Z0-9.\-%]+$/; // host only; path-style did:web is unsupported
const HANDLE = /^([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/;

export interface ResolvedIdentity {
  did: string | null;
  item: IdentityItem | null;
  issues: AdapterIssue[];
}

export function didMethod(did: string): 'plc' | 'web' | null {
  if (DID_PLC.test(did)) return 'plc';
  if (DID_WEB.test(did)) return 'web';
  return null;
}

/** Handle -> DID through the public AppView. */
export async function resolveHandle(ctx: AdapterContext, handle: string) {
  if (!HANDLE.test(handle)) {
    return { did: null, issue: issue(SRC, 'invalid-request', 'error', 'That handle is not a valid domain-style handle.') };
  }
  const r = await getJson<unknown>(
    ctx,
    `${ctx.endpoints.appView}/xrpc/com.atproto.identity.resolveHandle?handle=${encodeURIComponent(handle)}`,
    { source: SRC, label: 'resolve handle' },
  );
  if (!r.ok) return { did: null, issue: r.issue };
  const did = isRecord(r.value) ? asString(r.value.did) : null;
  if (!did || !didMethod(did)) {
    return { did: null, issue: issue(SRC, 'bad-response', 'error', 'Handle resolution returned an invalid DID.') };
  }
  return { did, issue: null };
}

/** Fetch the DID document for did:plc (plc.directory) or did:web (well-known). */
export async function fetchDidDocument(ctx: AdapterContext, did: string) {
  const method = didMethod(did);
  let url: string;
  if (method === 'plc') {
    url = `${ctx.endpoints.plcDirectory}/${did}`;
  } else if (method === 'web') {
    const host = decodeURIComponent(did.slice('did:web:'.length));
    url = `https://${host}/.well-known/did.json`;
    if (!safeServiceOrigin(`https://${host}/`, ctx)) {
      return { doc: null, issue: issue(SRC, 'unsafe-url', 'error', 'did:web host is not a public https host.') };
    }
  } else {
    return { doc: null, issue: issue(SRC, 'invalid-did', 'error', 'Not a supported DID (expected did:plc or host-only did:web).') };
  }
  const r = await getJson<unknown>(ctx, url, { source: SRC, label: 'DID document' });
  if (!r.ok) return { doc: null, issue: r.issue };
  if (!isRecord(r.value) || r.value.id !== did) {
    return { doc: null, issue: issue(SRC, 'bad-response', 'error', 'DID document did not match the requested DID.') };
  }
  return { doc: r.value, issue: null };
}

/** `at://handle` entries of alsoKnownAs, in order. */
function handlesFrom(alsoKnownAs: unknown): string[] {
  if (!Array.isArray(alsoKnownAs)) return [];
  return alsoKnownAs
    .filter((x): x is string => typeof x === 'string' && x.startsWith('at://'))
    .map((x) => x.slice('at://'.length).toLowerCase());
}

function pdsFrom(doc: Record<string, unknown>): unknown {
  const services = Array.isArray(doc.service) ? doc.service : [];
  for (const s of services) {
    if (!isRecord(s) || typeof s.id !== 'string') continue;
    if (s.id === '#atproto_pds' || s.id.endsWith('#atproto_pds')) return s.serviceEndpoint;
  }
  return null;
}

/**
 * Read a PLC audit log: creation date + every handle ever seen.
 * Nullified operations (overridden by a recovery key) are skipped.
 */
export async function fetchPlcHistory(ctx: AdapterContext, did: string) {
  const r = await getJson<unknown>(ctx, `${ctx.endpoints.plcDirectory}/${did}/log/audit`, {
    source: SRC,
    label: 'PLC audit log',
  });
  if (!r.ok) return { createdAt: null, history: null, issue: r.issue };
  if (!Array.isArray(r.value)) {
    return { createdAt: null, history: null, issue: issue(SRC, 'bad-response', 'warning', 'PLC audit log was not a list.') };
  }
  let createdAt: string | null = null;
  const seen = new Set<string>();
  const history: { handle: string; firstSeenAt: string }[] = [];
  for (const entry of r.value) {
    if (!isRecord(entry) || entry.nullified === true) continue;
    const at = asString(entry.createdAt);
    if (!at) continue;
    createdAt ??= at;
    const op = isRecord(entry.operation) ? entry.operation : {};
    for (const h of handlesFrom(op.alsoKnownAs)) {
      if (!seen.has(h)) {
        seen.add(h);
        history.push({ handle: h, firstSeenAt: at });
      }
    }
  }
  return { createdAt, history, issue: null };
}

/**
 * Build the identity card for the requested subject.
 * Never throws. On failure `item` may be null and `issues` explains why.
 */
export async function resolveIdentity(ctx: AdapterContext, req: AdapterRequest): Promise<ResolvedIdentity> {
  const issues: AdapterIssue[] = [];
  let did = req.subject.did ?? null;
  const askedHandle = req.subject.handle?.toLowerCase() ?? null;

  if (!did && askedHandle) {
    const r = await resolveHandle(ctx, askedHandle);
    if (r.issue) return { did: null, item: null, issues: [r.issue] };
    did = r.did;
  }
  if (!did) {
    return { did: null, item: null, issues: [issue(SRC, 'invalid-request', 'error', 'Need a DID or a handle to read an account.')] };
  }
  const method = didMethod(did);
  if (!method) {
    return { did, item: null, issues: [issue(SRC, 'invalid-did', 'error', 'Not a supported DID (expected did:plc or host-only did:web).')] };
  }

  const fetchedAt = ctx.now().toISOString();
  const docRes = await fetchDidDocument(ctx, did);
  let handle: string | null = null;
  let pdsUrl: string | null = null;

  if (docRes.doc) {
    handle = handlesFrom(docRes.doc.alsoKnownAs)[0] ?? null;
    const rawPds = pdsFrom(docRes.doc);
    pdsUrl = safeServiceOrigin(rawPds, ctx);
    if (!pdsUrl) {
      issues.push(issue(SRC, 'unsafe-url', 'error', 'The DID document has no usable, public https PDS address.'));
    }
  } else if (docRes.issue) {
    issues.push(docRes.issue);
    // Fall back to the caller's hint, loudly.
    const hint = safeServiceOrigin(req.subject.pdsUrl, ctx);
    if (hint) {
      pdsUrl = hint;
      issues.push(issue(SRC, 'pds-unverified', 'warning', 'Using the PDS address supplied by the caller; it could not be checked against the DID document.'));
    }
  }

  // Verify handle <-> DID, and fetch history, in parallel. Both are best-effort.
  const verify = handle ? resolveHandle(ctx, handle) : Promise.resolve(null);
  const hist =
    method === 'plc' && req.options?.includeIdentityHistory !== false
      ? fetchPlcHistory(ctx, did)
      : Promise.resolve(null);
  const [v, h] = await Promise.all([verify, hist]);

  let handleVerified: boolean | null = null;
  if (v) {
    if (v.did) handleVerified = v.did === did;
    // A failed verification lookup leaves handleVerified null (unknown); not an error.
  }
  if (handle && handleVerified === false) {
    issues.push(issue(SRC, 'handle-mismatch', 'warning', 'The handle in the DID document does not resolve back to this DID.'));
  }
  if (askedHandle && handle && askedHandle !== handle) {
    issues.push(issue(SRC, 'handle-mismatch', 'warning', 'The requested handle differs from the account\'s current handle.'));
  }
  if (h?.issue) issues.push({ ...h.issue, severity: 'warning' });
  if (method === 'web') {
    issues.push(issue(SRC, 'unsupported-did-method', 'info', 'Creation date and past handles are only available for did:plc accounts.'));
  }

  const item: IdentityItem = {
    kind: 'identity',
    source: SRC,
    fetchedAt,
    did,
    didMethod: method,
    handle,
    handleVerified,
    pdsUrl,
    createdAt: h?.createdAt ?? null,
    handleHistory: h?.history ?? null,
  };
  return { did, item, issues };
}
