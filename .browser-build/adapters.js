"use strict";
var Adapters = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // src/adapters/index.ts
  var index_exports = {};
  __export(index_exports, {
    ADAPTERS_SCHEMA_VERSION: () => ADAPTERS_SCHEMA_VERSION,
    FIXTURE_SCENARIOS: () => FIXTURE_SCENARIOS,
    SOURCE_IDS: () => SOURCE_IDS,
    collect: () => collect,
    createAtprotoAdapter: () => createAtprotoAdapter,
    createBlueskyAdapter: () => createBlueskyAdapter,
    createContext: () => createContext,
    createFixtureFetch: () => createFixtureFetch,
    createFixturePipeline: () => createFixturePipeline,
    createFixturesAdapter: () => createFixturesAdapter,
    createLivePipeline: () => createLivePipeline
  });

  // src/adapters/contract.ts
  var ADAPTERS_SCHEMA_VERSION = 1;
  var SOURCE_IDS = ["atproto", "bluesky", "fixtures"];

  // src/adapters/context.ts
  function defaultSleep(ms, signal) {
    return new Promise((resolve) => {
      if (signal?.aborted) return resolve();
      const t = setTimeout(done, ms);
      function done() {
        clearTimeout(t);
        signal?.removeEventListener("abort", done);
        resolve();
      }
      signal?.addEventListener("abort", done, { once: true });
    });
  }
  function createContext(overrides = {}) {
    return {
      fetch: overrides.fetch ?? ((...a) => globalThis.fetch(...a)),
      signal: overrides.signal,
      now: overrides.now ?? (() => /* @__PURE__ */ new Date()),
      endpoints: {
        plcDirectory: "https://plc.directory",
        appView: "https://public.api.bsky.app",
        ...overrides.endpoints
      },
      timeoutMs: overrides.timeoutMs ?? 1e4,
      maxRetries: overrides.maxRetries ?? 2,
      maxRetryAfterMs: overrides.maxRetryAfterMs ?? 5e3,
      sleep: overrides.sleep ?? defaultSleep,
      allowInsecureHosts: overrides.allowInsecureHosts ?? false
    };
  }

  // src/adapters/util.ts
  async function mapPool(items, limit, fn) {
    const out = new Array(items.length);
    let next = 0;
    const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i], i);
      }
    });
    await Promise.all(workers);
    return out;
  }
  function issue(source, code, severity, message, extra = {}) {
    return { source, code, severity, message, retryable: extra.retryable ?? false, ...extra };
  }
  var isRecord = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
  var asString = (v) => typeof v === "string" ? v : null;
  var asCount = (v) => typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null;
  function chunk(arr, size) {
    const out = [];
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
  }
  function parseAtUri(uri) {
    const m = /^at:\/\/([^/]+)\/([^/]+)\/([^/]+)$/.exec(uri);
    return m ? { did: m[1], collection: m[2], rkey: m[3] } : null;
  }

  // src/adapters/http.ts
  async function getJson(ctx, url, opts) {
    const doFetch = opts.fetch ?? ctx.fetch;
    const extra = opts.collection ? { collection: opts.collection } : {};
    let last = null;
    for (let attempt = 0; attempt <= ctx.maxRetries; attempt++) {
      if (ctx.signal?.aborted) {
        return fail(issue(opts.source, "aborted", "warning", `${opts.label}: cancelled.`, extra));
      }
      const timeout = AbortSignal.timeout(ctx.timeoutMs);
      const signal = ctx.signal ? AbortSignal.any([ctx.signal, timeout]) : timeout;
      let res;
      try {
        res = await doFetch(url, { headers: { accept: "application/json", ...opts.headers }, signal });
      } catch {
        if (ctx.signal?.aborted) {
          return fail(issue(opts.source, "aborted", "warning", `${opts.label}: cancelled.`, extra));
        }
        last = timeout.aborted ? issue(opts.source, "timeout", "error", `${opts.label}: timed out after ${ctx.timeoutMs} ms.`, { retryable: true, ...extra }) : issue(opts.source, "network", "error", `${opts.label}: network error.`, { retryable: true, ...extra });
        await ctx.sleep(backoff(attempt), ctx.signal);
        continue;
      }
      if (res.ok) {
        try {
          return { ok: true, value: await res.json(), status: res.status };
        } catch {
          return fail(issue(opts.source, "bad-response", "error", `${opts.label}: response was not valid JSON.`, { httpStatus: res.status, ...extra }));
        }
      }
      const detail = await xrpcDetail(res);
      const status = res.status;
      if (status === 429) {
        const wait = retryAfterMs(res, ctx.now());
        last = issue(opts.source, "rate-limited", "error", `${opts.label}: rate limited by the server.`, { retryable: true, httpStatus: status, ...extra });
        if (wait === null || wait > ctx.maxRetryAfterMs) return fail(last);
        await ctx.sleep(wait, ctx.signal);
        continue;
      }
      if (status >= 500) {
        last = issue(opts.source, "http-error", "error", `${opts.label}: server error ${status}.`, { retryable: true, httpStatus: status, ...extra });
        await ctx.sleep(backoff(attempt), ctx.signal);
        continue;
      }
      if (status === 404) return fail(issue(opts.source, "not-found", "error", `${opts.label}: not found.`, { httpStatus: status, ...extra }));
      if (status === 401 || status === 403) return fail(issue(opts.source, "auth-required", "error", `${opts.label}: access denied (${status}).`, { httpStatus: status, ...extra }));
      if (status === 400) {
        const code = detail === "RepoNotFound" || detail === "RepoTakendown" || detail === "RepoDeactivated" ? "not-found" : "bad-request";
        return fail(issue(opts.source, code, "error", `${opts.label}: ${detail ?? "request rejected"}.`, { httpStatus: status, ...extra }));
      }
      return fail(issue(opts.source, "http-error", "error", `${opts.label}: unexpected status ${status}.`, { httpStatus: status, ...extra }));
    }
    return fail(last ?? issue(opts.source, "network", "error", `${opts.label}: failed.`, { retryable: true, ...extra }));
  }
  function fail(i) {
    return { ok: false, issue: i };
  }
  function backoff(attempt) {
    return 250 * 2 ** attempt;
  }
  function retryAfterMs(res, now) {
    const h = res.headers.get("retry-after");
    if (h === null) return null;
    const secs = Number(h);
    if (Number.isFinite(secs) && secs >= 0) return secs * 1e3;
    const date = Date.parse(h);
    return Number.isNaN(date) ? null : Math.max(0, date - now.getTime());
  }
  async function xrpcDetail(res) {
    try {
      const body = await res.json();
      return isRecord(body) && typeof body.error === "string" ? body.error : null;
    } catch {
      return null;
    }
  }
  function safeServiceOrigin(raw, ctx) {
    if (typeof raw !== "string") return null;
    let u;
    try {
      u = new URL(raw);
    } catch {
      return null;
    }
    if (u.username || u.password || u.search || u.hash || u.pathname !== "/") return null;
    if (ctx.allowInsecureHosts) return u.protocol === "https:" || u.protocol === "http:" ? u.origin : null;
    if (u.protocol !== "https:") return null;
    const host = u.hostname.toLowerCase();
    const isIp = /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(":") || host.startsWith("[");
    if (isIp || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal") || !host.includes(".")) {
      return null;
    }
    return u.origin;
  }

  // src/adapters/atproto/identity.ts
  var SRC = "atproto";
  var DID_PLC = /^did:plc:[a-z2-7]{24}$/;
  var DID_WEB = /^did:web:[a-zA-Z0-9.\-%]+$/;
  var HANDLE = /^([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/;
  function didMethod(did) {
    if (DID_PLC.test(did)) return "plc";
    if (DID_WEB.test(did)) return "web";
    return null;
  }
  async function resolveHandle(ctx, handle) {
    if (!HANDLE.test(handle)) {
      return { did: null, issue: issue(SRC, "invalid-request", "error", "That handle is not a valid domain-style handle.") };
    }
    const r = await getJson(
      ctx,
      `${ctx.endpoints.appView}/xrpc/com.atproto.identity.resolveHandle?handle=${encodeURIComponent(handle)}`,
      { source: SRC, label: "resolve handle" }
    );
    if (!r.ok) return { did: null, issue: r.issue };
    const did = isRecord(r.value) ? asString(r.value.did) : null;
    if (!did || !didMethod(did)) {
      return { did: null, issue: issue(SRC, "bad-response", "error", "Handle resolution returned an invalid DID.") };
    }
    return { did, issue: null };
  }
  async function fetchDidDocument(ctx, did) {
    const method = didMethod(did);
    let url;
    if (method === "plc") {
      url = `${ctx.endpoints.plcDirectory}/${did}`;
    } else if (method === "web") {
      const host = decodeURIComponent(did.slice("did:web:".length));
      url = `https://${host}/.well-known/did.json`;
      if (!safeServiceOrigin(`https://${host}/`, ctx)) {
        return { doc: null, issue: issue(SRC, "unsafe-url", "error", "did:web host is not a public https host.") };
      }
    } else {
      return { doc: null, issue: issue(SRC, "invalid-did", "error", "Not a supported DID (expected did:plc or host-only did:web).") };
    }
    const r = await getJson(ctx, url, { source: SRC, label: "DID document" });
    if (!r.ok) return { doc: null, issue: r.issue };
    if (!isRecord(r.value) || r.value.id !== did) {
      return { doc: null, issue: issue(SRC, "bad-response", "error", "DID document did not match the requested DID.") };
    }
    return { doc: r.value, issue: null };
  }
  function handlesFrom(alsoKnownAs) {
    if (!Array.isArray(alsoKnownAs)) return [];
    return alsoKnownAs.filter((x) => typeof x === "string" && x.startsWith("at://")).map((x) => x.slice("at://".length).toLowerCase());
  }
  function pdsFrom(doc) {
    const services = Array.isArray(doc.service) ? doc.service : [];
    for (const s of services) {
      if (!isRecord(s) || typeof s.id !== "string") continue;
      if (s.id === "#atproto_pds" || s.id.endsWith("#atproto_pds")) return s.serviceEndpoint;
    }
    return null;
  }
  async function fetchPlcHistory(ctx, did) {
    const r = await getJson(ctx, `${ctx.endpoints.plcDirectory}/${did}/log/audit`, {
      source: SRC,
      label: "PLC audit log"
    });
    if (!r.ok) return { createdAt: null, history: null, issue: r.issue };
    if (!Array.isArray(r.value)) {
      return { createdAt: null, history: null, issue: issue(SRC, "bad-response", "warning", "PLC audit log was not a list.") };
    }
    let createdAt = null;
    const seen = /* @__PURE__ */ new Set();
    const history = [];
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
  async function resolveIdentity(ctx, req) {
    const issues = [];
    let did = req.subject.did ?? null;
    const askedHandle = req.subject.handle?.toLowerCase() ?? null;
    if (!did && askedHandle) {
      const r = await resolveHandle(ctx, askedHandle);
      if (r.issue) return { did: null, item: null, issues: [r.issue] };
      did = r.did;
    }
    if (!did) {
      return { did: null, item: null, issues: [issue(SRC, "invalid-request", "error", "Need a DID or a handle to read an account.")] };
    }
    const method = didMethod(did);
    if (!method) {
      return { did, item: null, issues: [issue(SRC, "invalid-did", "error", "Not a supported DID (expected did:plc or host-only did:web).")] };
    }
    const fetchedAt = ctx.now().toISOString();
    const docRes = await fetchDidDocument(ctx, did);
    let handle = null;
    let pdsUrl = null;
    if (docRes.doc) {
      handle = handlesFrom(docRes.doc.alsoKnownAs)[0] ?? null;
      const rawPds = pdsFrom(docRes.doc);
      pdsUrl = safeServiceOrigin(rawPds, ctx);
      if (!pdsUrl) {
        issues.push(issue(SRC, "unsafe-url", "error", "The DID document has no usable, public https PDS address."));
      }
    } else if (docRes.issue) {
      issues.push(docRes.issue);
      const hint = safeServiceOrigin(req.subject.pdsUrl, ctx);
      if (hint) {
        pdsUrl = hint;
        issues.push(issue(SRC, "pds-unverified", "warning", "Using the PDS address supplied by the caller; it could not be checked against the DID document."));
      }
    }
    const verify = handle ? resolveHandle(ctx, handle) : Promise.resolve(null);
    const hist = method === "plc" && req.options?.includeIdentityHistory !== false ? fetchPlcHistory(ctx, did) : Promise.resolve(null);
    const [v, h] = await Promise.all([verify, hist]);
    let handleVerified = null;
    if (v) {
      if (v.did) handleVerified = v.did === did;
    }
    if (handle && handleVerified === false) {
      issues.push(issue(SRC, "handle-mismatch", "warning", "The handle in the DID document does not resolve back to this DID."));
    }
    if (askedHandle && handle && askedHandle !== handle) {
      issues.push(issue(SRC, "handle-mismatch", "warning", "The requested handle differs from the account's current handle."));
    }
    if (h?.issue) issues.push({ ...h.issue, severity: "warning" });
    if (method === "web") {
      issues.push(issue(SRC, "unsupported-did-method", "info", "Creation date and past handles are only available for did:plc accounts."));
    }
    const item = {
      kind: "identity",
      source: SRC,
      fetchedAt,
      did,
      didMethod: method,
      handle,
      handleVerified,
      pdsUrl,
      createdAt: h?.createdAt ?? null,
      handleHistory: h?.history ?? null
    };
    return { did, item, issues };
  }

  // src/adapters/atproto/repo.ts
  var SRC2 = "atproto";
  var PAGE_SIZE = 100;
  var DEFAULT_MAX_RECORDS = 1e3;
  var MAX_PAGES = 1e3;
  function pdsAuth(req, did, issues) {
    const s = req.session;
    if (!s) return {};
    if (s.did !== did) {
      issues.push(
        issue(SRC2, "session-mismatch", "warning", "The signed-in account is not the account being read; its credentials were not used.")
      );
      return {};
    }
    if (s.fetch) return { fetch: s.fetch };
    if (s.accessToken) return { headers: { authorization: `Bearer ${s.accessToken}` } };
    return {};
  }
  async function describeRepo(ctx, pds, did, auth = {}) {
    const r = await getJson(
      ctx,
      `${pds}/xrpc/com.atproto.repo.describeRepo?repo=${encodeURIComponent(did)}`,
      { source: SRC2, label: "describe repo", ...auth }
    );
    if (!r.ok) return { collections: null, issue: r.issue };
    const cols = isRecord(r.value) && Array.isArray(r.value.collections) ? r.value.collections : null;
    if (!cols) {
      return { collections: null, issue: issue(SRC2, "bad-response", "error", "describe repo returned no collection list.") };
    }
    return { collections: cols.filter((c) => typeof c === "string").sort(), issue: null };
  }
  async function readCollection(ctx, pds, did, collection, cap, auth, newestFirst) {
    const items = [];
    const issues = [];
    let cursor;
    let skipped = 0;
    let complete = false;
    let reason;
    for (let page = 0; page < MAX_PAGES; page++) {
      const limit = Math.min(PAGE_SIZE, cap - items.length);
      if (limit <= 0) {
        reason = "record-cap";
        break;
      }
      const qs = new URLSearchParams({ repo: did, collection, limit: String(limit) });
      if (newestFirst) qs.set("reverse", "true");
      if (cursor) qs.set("cursor", cursor);
      const r = await getJson(ctx, `${pds}/xrpc/com.atproto.repo.listRecords?${qs}`, {
        source: SRC2,
        label: `read ${collection}`,
        collection,
        ...auth
      });
      if (!r.ok) {
        issues.push(r.issue);
        reason = r.issue.code === "aborted" ? "aborted" : "error";
        break;
      }
      const body = r.value;
      const records = isRecord(body) && Array.isArray(body.records) ? body.records : null;
      if (!records) {
        issues.push(issue(SRC2, "bad-response", "error", `${collection}: response had no record list.`, { collection }));
        reason = "error";
        break;
      }
      const fetchedAt = ctx.now().toISOString();
      for (const rec of records) {
        const uri = isRecord(rec) ? asString(rec.uri) : null;
        const cid = isRecord(rec) ? asString(rec.cid) : null;
        const parts = uri ? parseAtUri(uri) : null;
        if (!isRecord(rec) || !uri || !cid || !parts || parts.did !== did || parts.collection !== collection || !isRecord(rec.value)) {
          skipped++;
          continue;
        }
        items.push({ kind: "record", source: SRC2, fetchedAt, collection, rkey: parts.rkey, uri, cid, value: rec.value });
      }
      const next = isRecord(body) ? asString(body.cursor) : null;
      if (!next || records.length === 0) {
        complete = true;
        break;
      }
      if (next === cursor) {
        issues.push(issue(SRC2, "bad-response", "warning", `${collection}: server repeated its page cursor; stopped early.`, { collection }));
        reason = "error";
        break;
      }
      cursor = next;
    }
    if (!complete && !reason) reason = "record-cap";
    if (skipped > 0) {
      issues.push(issue(SRC2, "bad-response", "warning", `${collection}: ${skipped} malformed or foreign record(s) were ignored.`, { collection }));
    }
    return {
      items,
      issues,
      coverage: [{ source: SRC2, collection, fetched: items.length, complete, ...complete ? {} : { reason } }]
    };
  }
  async function readRepo(ctx, req, pds, did) {
    const issues = [];
    const auth = pdsAuth(req, did, issues);
    const cap = Math.max(1, Math.floor(req.options?.maxRecordsPerCollection ?? DEFAULT_MAX_RECORDS));
    let collections = req.collections ? [...new Set(req.collections)] : null;
    if (!collections) {
      const d = await describeRepo(ctx, pds, did, auth);
      if (!d.collections) {
        return { items: [], issues: [...issues, d.issue], coverage: [{ source: SRC2, collection: "(all)", fetched: 0, complete: false, reason: "error" }] };
      }
      collections = d.collections;
    }
    const results = await mapPool(
      collections,
      req.options?.maxConcurrentCollections ?? 3,
      (c) => readCollection(ctx, pds, did, c, cap, auth, req.options?.order !== "oldest-first")
    );
    return {
      items: results.flatMap((r) => r.items),
      issues: [...issues, ...results.flatMap((r) => r.issues)],
      coverage: results.flatMap((r) => r.coverage)
    };
  }

  // src/adapters/atproto/index.ts
  function createAtprotoAdapter() {
    return {
      id: "atproto",
      async run(ctx, req) {
        const out = { items: [], issues: [], coverage: [] };
        const id = await resolveIdentity(ctx, req);
        out.issues.push(...id.issues);
        if (id.item) out.items.push(id.item);
        if (!id.did || !id.item?.pdsUrl) return out;
        const repo = await readRepo(ctx, req, id.item.pdsUrl, id.did);
        out.items.push(...repo.items);
        out.issues.push(...repo.issues);
        out.coverage.push(...repo.coverage);
        return out;
      }
    };
  }

  // src/adapters/bluesky/index.ts
  var SRC3 = "bluesky";
  var POST_COLLECTION = "app.bsky.feed.post";
  var GET_POSTS_MAX = 25;
  var FEED_PAGE = 100;
  var DEFAULT_MAX_POSTS = 1e3;
  function toEngagement(post, fetchedAt) {
    if (!isRecord(post)) return null;
    const uri = asString(post.uri);
    const cid = asString(post.cid);
    if (!uri || !cid) return null;
    return {
      kind: "engagement",
      source: SRC3,
      fetchedAt,
      uri,
      cid,
      // The AppView omits zero counts on some views; absent means 0 for these three.
      likeCount: asCount(post.likeCount) ?? 0,
      repostCount: asCount(post.repostCount) ?? 0,
      replyCount: asCount(post.replyCount) ?? 0,
      quoteCount: asCount(post.quoteCount),
      indexedAt: asString(post.indexedAt)
    };
  }
  async function readProfile(ctx, actor) {
    const r = await getJson(
      ctx,
      `${ctx.endpoints.appView}/xrpc/app.bsky.actor.getProfile?actor=${encodeURIComponent(actor)}`,
      { source: SRC3, label: "profile counts" }
    );
    if (!r.ok) return { item: null, issue: { ...r.issue, severity: "warning" } };
    const p = r.value;
    const did = isRecord(p) ? asString(p.did) : null;
    const handle = isRecord(p) ? asString(p.handle) : null;
    if (!isRecord(p) || !did || !handle) {
      return { item: null, issue: issue(SRC3, "bad-response", "warning", "Profile response was incomplete.") };
    }
    const item = {
      kind: "profile-stats",
      source: SRC3,
      fetchedAt: ctx.now().toISOString(),
      did,
      handle,
      displayName: asString(p.displayName),
      followersCount: asCount(p.followersCount),
      followsCount: asCount(p.followsCount),
      postsCount: asCount(p.postsCount),
      createdAt: asString(p.createdAt)
    };
    return { item, issue: null };
  }
  async function readCountsForUris(ctx, uris) {
    const issues = [];
    const found = /* @__PURE__ */ new Map();
    const wanted = new Set(uris);
    let failed = 0;
    const batches = chunk(uris, GET_POSTS_MAX);
    const results = await mapPool(batches, 3, async (batch) => {
      const qs = batch.map((u) => `uris=${encodeURIComponent(u)}`).join("&");
      return getJson(ctx, `${ctx.endpoints.appView}/xrpc/app.bsky.feed.getPosts?${qs}`, {
        source: SRC3,
        label: "post counts",
        collection: POST_COLLECTION
      });
    });
    const fetchedAt = ctx.now().toISOString();
    results.forEach((r, i) => {
      if (!r.ok) {
        failed += batches[i].length;
        issues.push(r.issue);
        return;
      }
      const posts = isRecord(r.value) && Array.isArray(r.value.posts) ? r.value.posts : null;
      if (!posts) {
        failed += batches[i].length;
        issues.push(issue(SRC3, "bad-response", "error", "post counts: response had no post list.", { collection: POST_COLLECTION }));
        return;
      }
      for (const p of posts) {
        const e = toEngagement(p, fetchedAt);
        if (e && wanted.has(e.uri)) found.set(e.uri, e);
      }
    });
    return { found: [...found.values()], issues, failed };
  }
  async function readCountsFromFeed(ctx, did, cap) {
    const issues = [];
    const items = [];
    const seen = /* @__PURE__ */ new Set();
    let cursor;
    let complete = false;
    let reason;
    const fetchedAt = ctx.now().toISOString();
    for (let page = 0; page < 1e3; page++) {
      const limit = Math.min(FEED_PAGE, cap - items.length);
      if (limit <= 0) {
        reason = "record-cap";
        break;
      }
      const qs = new URLSearchParams({ actor: did, limit: String(limit), filter: "posts_with_replies" });
      if (cursor) qs.set("cursor", cursor);
      const r = await getJson(ctx, `${ctx.endpoints.appView}/xrpc/app.bsky.feed.getAuthorFeed?${qs}`, {
        source: SRC3,
        label: "author feed",
        collection: POST_COLLECTION
      });
      if (!r.ok) {
        issues.push(r.issue);
        reason = r.issue.code === "aborted" ? "aborted" : "error";
        break;
      }
      const feed = isRecord(r.value) && Array.isArray(r.value.feed) ? r.value.feed : null;
      if (!feed) {
        issues.push(issue(SRC3, "bad-response", "error", "author feed: response had no feed list.", { collection: POST_COLLECTION }));
        reason = "error";
        break;
      }
      for (const entry of feed) {
        if (!isRecord(entry) || entry.reason) continue;
        const post = entry.post;
        const author = isRecord(post) && isRecord(post.author) ? asString(post.author.did) : null;
        if (author !== did) continue;
        const e = toEngagement(post, fetchedAt);
        if (e && !seen.has(e.uri)) {
          seen.add(e.uri);
          items.push(e);
        }
      }
      const next = isRecord(r.value) ? asString(r.value.cursor) : null;
      if (!next || feed.length === 0) {
        complete = true;
        break;
      }
      if (next === cursor) {
        reason = "error";
        issues.push(issue(SRC3, "bad-response", "warning", "author feed: server repeated its page cursor; stopped early.", { collection: POST_COLLECTION }));
        break;
      }
      cursor = next;
    }
    if (!complete && !reason) reason = "record-cap";
    return { items, issues, complete, reason };
  }
  function createBlueskyAdapter() {
    return {
      id: "bluesky",
      async run(ctx, req, upstream) {
        const out = { items: [], issues: [], coverage: [] };
        const upstreamIdentity = upstream.find((i) => i.kind === "identity");
        const did = upstreamIdentity?.did ?? req.subject.did ?? null;
        const actor = did ?? req.subject.handle ?? null;
        if (!actor) {
          out.issues.push(issue(SRC3, "invalid-request", "error", "Need a DID or a handle to read public counts."));
          return out;
        }
        const profile = await readProfile(ctx, actor);
        if (profile.item) out.items.push(profile.item);
        if (profile.issue) out.issues.push(profile.issue);
        if (req.options?.includeEngagement === false) return out;
        const resolvedDid = did ?? profile.item?.did ?? null;
        if (!resolvedDid) return out;
        const cap = Math.max(1, Math.floor(req.options?.maxRecordsPerCollection ?? DEFAULT_MAX_POSTS));
        const postsWanted = !req.collections || req.collections.includes(POST_COLLECTION);
        if (!postsWanted) return out;
        const uris = [...new Set(upstream.flatMap((i) => i.kind === "record" && i.collection === POST_COLLECTION ? [i.uri] : []))];
        if (uris.length > 0) {
          const r = await readCountsForUris(ctx, uris);
          out.items.push(...r.found);
          out.issues.push(...r.issues);
          const missing = uris.length - r.found.length - r.failed;
          if (missing > 0) {
            out.issues.push(
              issue(SRC3, "not-indexed", "info", `${missing} post(s) have no public counts (deleted, or not indexed by the AppView).`, { collection: POST_COLLECTION })
            );
          }
          const complete = r.found.length === uris.length;
          out.coverage.push({
            source: SRC3,
            collection: "engagement",
            fetched: r.found.length,
            complete,
            ...complete ? {} : { reason: r.failed > 0 ? "error" : "not-indexed" }
          });
        } else {
          const r = await readCountsFromFeed(ctx, resolvedDid, cap);
          out.items.push(...r.items);
          out.issues.push(...r.issues);
          out.coverage.push({
            source: SRC3,
            collection: "engagement",
            fetched: r.items.length,
            complete: r.complete,
            ...r.complete ? {} : { reason: r.reason }
          });
        }
        return out;
      }
    };
  }

  // src/adapters/fixtures/data.ts
  var FIXTURE_SCENARIOS = [
    "typical",
    "empty",
    "appview-down",
    "rate-limited",
    "pds-down"
  ];
  var FIXTURE_DID = "did:plc:fixtureaaaaaaaaaaaaaaaaa";
  var FIXTURE_HANDLE = "alice.fixture.test";
  var FIXTURE_OLD_HANDLE = "alice-old.fixture.test";
  var FIXTURE_PDS = "https://pds.fixture.test";
  var FIXTURE_CREATED_AT = "2025-03-01T12:00:00.000Z";
  var FIXTURE_HANDLE_CHANGED_AT = "2025-09-15T08:30:00.000Z";
  var OTHER_DID = (n) => `did:plc:fixture${"b".repeat(16)}${n % 6 + 2}`;
  function mulberry32(seed) {
    let a = seed >>> 0;
    return () => {
      a = a + 1831565813 >>> 0;
      let t = a;
      t = Math.imul(t ^ t >>> 15, t | 1);
      t ^= t + Math.imul(t ^ t >>> 7, t | 61);
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  var TID_ALPHABET = "234567abcdefghijklmnopqrstuvwxyz";
  function rkey(n) {
    let s = "";
    let v = n + 1e3;
    for (let i = 0; i < 13; i++) {
      s = TID_ALPHABET[v % 32] + s;
      v = Math.floor(v / 32);
    }
    return s;
  }
  function fakeCid(kind, n) {
    return `bafyfixture${kind}${String(n).padStart(6, "0")}`;
  }
  var BASE_MS = Date.parse("2025-09-01T00:00:00.000Z");
  var DAY = 864e5;
  function buildDataset(scenario = "typical") {
    const empty = scenario === "empty";
    const rand = mulberry32(210);
    const did = FIXTURE_DID;
    const uri = (collection, key) => `at://${did}/${collection}/${key}`;
    const collections = {
      "app.bsky.actor.profile": [],
      "app.bsky.feed.post": [],
      "app.bsky.feed.like": [],
      "app.bsky.feed.repost": [],
      "app.bsky.graph.follow": [],
      "app.bsky.graph.block": [],
      "site.standard.document": []
    };
    const postCounts = {};
    if (!empty) {
      collections["app.bsky.actor.profile"].push({
        uri: uri("app.bsky.actor.profile", "self"),
        cid: fakeCid("prof", 0),
        value: { $type: "app.bsky.actor.profile", displayName: "Alice Fixture", description: "Synthetic test account." }
      });
      const postUris = [];
      for (let i = 0; i < 60; i++) {
        const key = rkey(i);
        const u = uri("app.bsky.feed.post", key);
        const createdAt = new Date(BASE_MS + i * 2 * DAY + Math.floor(rand() * 20) * 36e5).toISOString();
        const isReply = i % 7 === 3 && postUris.length > 0;
        const value = {
          $type: "app.bsky.feed.post",
          text: `Fixture post ${i} ${i % 4 === 0 ? "#fixture" : ""}`.trim(),
          createdAt,
          langs: ["en"]
        };
        if (isReply) {
          const parent = { uri: postUris[postUris.length - 1], cid: fakeCid("post", i - 1) };
          value.reply = { root: parent, parent };
        }
        collections["app.bsky.feed.post"].push({ uri: u, cid: fakeCid("post", i), value });
        postUris.push(u);
        postCounts[u] = {
          likeCount: Math.floor(rand() * 40),
          repostCount: Math.floor(rand() * 8),
          replyCount: Math.floor(rand() * 6),
          quoteCount: Math.floor(rand() * 3)
        };
      }
      for (let i = 0; i < 40; i++) {
        collections["app.bsky.feed.like"].push({
          uri: uri("app.bsky.feed.like", rkey(100 + i)),
          cid: fakeCid("like", i),
          value: {
            $type: "app.bsky.feed.like",
            subject: { uri: `at://${OTHER_DID(i)}/app.bsky.feed.post/${rkey(i)}`, cid: fakeCid("xpost", i) },
            createdAt: new Date(BASE_MS + i * 3 * DAY).toISOString()
          }
        });
      }
      for (let i = 0; i < 8; i++) {
        collections["app.bsky.feed.repost"].push({
          uri: uri("app.bsky.feed.repost", rkey(200 + i)),
          cid: fakeCid("rep", i),
          value: {
            $type: "app.bsky.feed.repost",
            subject: { uri: `at://${OTHER_DID(i)}/app.bsky.feed.post/${rkey(i)}`, cid: fakeCid("xpost", i) },
            createdAt: new Date(BASE_MS + i * 9 * DAY).toISOString()
          }
        });
      }
      for (let i = 0; i < 25; i++) {
        collections["app.bsky.graph.follow"].push({
          uri: uri("app.bsky.graph.follow", rkey(300 + i)),
          cid: fakeCid("fol", i),
          value: { $type: "app.bsky.graph.follow", subject: OTHER_DID(i), createdAt: new Date(BASE_MS + i * DAY).toISOString() }
        });
      }
      for (let i = 0; i < 2; i++) {
        collections["app.bsky.graph.block"].push({
          uri: uri("app.bsky.graph.block", rkey(400 + i)),
          cid: fakeCid("blk", i),
          value: { $type: "app.bsky.graph.block", subject: OTHER_DID(50 + i), createdAt: new Date(BASE_MS + i * 20 * DAY).toISOString() }
        });
      }
      collections["site.standard.document"].push({
        uri: uri("site.standard.document", rkey(500)),
        cid: fakeCid("doc", 0),
        value: { $type: "site.standard.document", title: "Fixture article", publishedAt: new Date(BASE_MS + 30 * DAY).toISOString() }
      });
    }
    return {
      scenario,
      did,
      handle: FIXTURE_HANDLE,
      collections,
      postCounts,
      profile: {
        displayName: "Alice Fixture",
        followersCount: empty ? 0 : 123,
        followsCount: collections["app.bsky.graph.follow"].length,
        postsCount: collections["app.bsky.feed.post"].length,
        createdAt: FIXTURE_CREATED_AT
      }
    };
  }

  // src/adapters/fixtures/fetch.ts
  var json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
  var xrpcError = (status, error, message = error) => json({ error, message }, status);
  function createFixtureFetch(scenario = "typical") {
    const dataset = buildDataset(scenario);
    const calls = [];
    const { did, handle } = dataset;
    const didDoc = {
      "@context": ["https://www.w3.org/ns/did/v1"],
      id: did,
      alsoKnownAs: [`at://${handle}`],
      service: [{ id: "#atproto_pds", type: "AtprotoPersonalDataServer", serviceEndpoint: FIXTURE_PDS }]
    };
    const audit = [
      {
        did,
        operation: { type: "plc_operation", alsoKnownAs: [`at://${FIXTURE_OLD_HANDLE}`] },
        cid: "bafyfixtureop1",
        nullified: false,
        createdAt: FIXTURE_CREATED_AT
      },
      {
        did,
        operation: { type: "plc_operation", alsoKnownAs: [`at://${FIXTURE_HANDLE}`] },
        cid: "bafyfixtureop2",
        nullified: false,
        createdAt: FIXTURE_HANDLE_CHANGED_AT
      }
    ];
    const allPosts = dataset.collections["app.bsky.feed.post"] ?? [];
    const postView = (r) => ({
      uri: r.uri,
      cid: r.cid,
      author: { did, handle },
      record: r.value,
      indexedAt: r.value.createdAt ?? null,
      ...dataset.postCounts[r.uri] ?? { likeCount: 0, repostCount: 0, replyCount: 0, quoteCount: 0 }
    });
    const impl = async (input) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
      calls.push(url.href);
      const q = url.searchParams;
      if (url.host === "plc.directory") {
        if (url.pathname === `/${did}`) return json(didDoc);
        if (url.pathname === `/${did}/log/audit`) return json(audit);
        return json({ message: "DID not registered" }, 404);
      }
      if (url.host === "public.api.bsky.app") {
        if (scenario === "appview-down") return xrpcError(503, "ServiceUnavailable");
        if (scenario === "rate-limited") {
          if (!url.pathname.endsWith("resolveHandle")) return json({ error: "RateLimitExceeded" }, 429, { "retry-after": "3600" });
        }
        switch (url.pathname) {
          case "/xrpc/com.atproto.identity.resolveHandle":
            return q.get("handle") === handle ? json({ did }) : xrpcError(400, "InvalidRequest", "Unable to resolve handle");
          case "/xrpc/app.bsky.actor.getProfile":
            if (q.get("actor") !== did && q.get("actor") !== handle) return xrpcError(400, "InvalidRequest", "Profile not found");
            return json({ did, handle, ...dataset.profile });
          case "/xrpc/app.bsky.feed.getPosts": {
            const wanted = q.getAll("uris");
            if (wanted.length > 25) return xrpcError(400, "InvalidRequest", "Too many uris");
            const set = new Set(wanted);
            return json({ posts: allPosts.filter((p) => set.has(p.uri)).map(postView) });
          }
          case "/xrpc/app.bsky.feed.getAuthorFeed": {
            if (q.get("actor") !== did && q.get("actor") !== handle) return xrpcError(400, "InvalidRequest", "Profile not found");
            const limit = Math.min(Number(q.get("limit") ?? 50), 100);
            const start = Number(q.get("cursor") ?? 0);
            const ordered = [...allPosts].reverse();
            const slice = ordered.slice(start, start + limit);
            const next = start + limit < ordered.length ? String(start + limit) : void 0;
            return json({ feed: slice.map((p) => ({ post: postView(p) })), ...next ? { cursor: next } : {} });
          }
        }
        return xrpcError(404, "MethodNotImplemented");
      }
      if (url.origin === FIXTURE_PDS) {
        if (scenario === "pds-down") return xrpcError(503, "ServiceUnavailable");
        if (q.get("repo") !== did) return xrpcError(400, "RepoNotFound", "Could not find repo");
        if (url.pathname === "/xrpc/com.atproto.repo.describeRepo") {
          return json({
            handle,
            did,
            didDoc,
            handleIsCorrect: true,
            collections: Object.entries(dataset.collections).filter(([, recs]) => recs.length > 0).map(([c]) => c)
          });
        }
        if (url.pathname === "/xrpc/com.atproto.repo.listRecords") {
          const col = q.get("collection") ?? "";
          const stored = dataset.collections[col];
          if (!stored) return json({ records: [] });
          const recs = q.get("reverse") === "true" ? [...stored].reverse() : stored;
          const limit = Math.min(Number(q.get("limit") ?? 50), 100);
          const start = Number(q.get("cursor") ?? 0);
          const slice = recs.slice(start, start + limit);
          const next = start + limit < recs.length ? String(start + limit) : void 0;
          return json({ records: slice, ...next ? { cursor: next } : {} });
        }
        return xrpcError(404, "MethodNotImplemented");
      }
      throw new TypeError(`fixture fetch: no route for ${url.host}`);
    };
    return { fetch: impl, calls, dataset };
  }

  // src/adapters/fixtures/index.ts
  function createFixturesAdapter(scenario = "typical") {
    const atproto = createAtprotoAdapter();
    const bluesky = createBlueskyAdapter();
    return {
      id: "fixtures",
      async run(ctx, req) {
        const fx = createFixtureFetch(scenario);
        const inner = {
          ...ctx,
          fetch: fx.fetch,
          sleep: async () => {
          },
          // the fake network never needs real waiting
          endpoints: { plcDirectory: "https://plc.directory", appView: "https://public.api.bsky.app" },
          allowInsecureHosts: false
        };
        const { session: _ignored, ...rest } = req;
        const r = { ...rest, subject: { did: FIXTURE_DID } };
        const a = await atproto.run(inner, r, []);
        const b = await bluesky.run(inner, r, a.items);
        const relabel = (x) => ({ ...x, source: "fixtures" });
        return {
          items: [...a.items, ...b.items].map((i) => relabel(i)),
          issues: [...a.issues, ...b.issues].map((i) => ({ ...relabel(i), message: `[synthetic] ${i.message}` })),
          coverage: [...a.coverage, ...b.coverage].map(relabel)
        };
      }
    };
  }

  // src/adapters/collect.ts
  function createLivePipeline() {
    return [[createAtprotoAdapter()], [createBlueskyAdapter()]];
  }
  function createFixturePipeline(scenario = "typical") {
    return [[createFixturesAdapter(scenario)]];
  }
  async function runOne(ctx, req, upstream, a) {
    try {
      return await a.run(ctx, req, upstream);
    } catch (err) {
      if (ctx.signal?.aborted) {
        return { items: [], issues: [issue(a.id, "aborted", "warning", `${a.id}: cancelled.`)], coverage: [] };
      }
      const reason = err instanceof Error ? err.name : "unknown error";
      return { items: [], issues: [issue(a.id, "adapter-crashed", "error", `${a.id} adapter crashed (${reason}).`)], coverage: [] };
    }
  }
  async function collect(req, opts = {}) {
    const ctx = createContext(opts.context);
    const pipeline = opts.pipeline ?? createLivePipeline();
    const items = [];
    const issues = [];
    const coverage = [];
    const ran = [];
    const startedAt = ctx.now().toISOString();
    if (!req?.subject || !req.subject.did && !req.subject.handle) {
      issues.push(issue("collector", "invalid-request", "error", "A DID or handle is required."));
    } else {
      for (const stage of pipeline) {
        const outs = await Promise.all(stage.map((a) => runOne(ctx, req, items, a)));
        stage.forEach((a, i) => {
          ran.push(a.id);
          const o = outs[i];
          items.push(...o.items);
          issues.push(...o.issues);
          coverage.push(...o.coverage);
        });
      }
    }
    const identity = items.find((i) => i.kind === "identity");
    const subject = {
      did: identity?.did ?? req?.subject?.did ?? null,
      handle: identity?.handle ?? req?.subject?.handle ?? null,
      pdsUrl: identity?.pdsUrl ?? null
    };
    return {
      schemaVersion: ADAPTERS_SCHEMA_VERSION,
      subject,
      fetchedAt: startedAt,
      items,
      issues,
      coverage,
      adapters: ran,
      complete: !issues.some((i) => i.severity === "error" || i.code === "aborted") && coverage.every((c) => c.complete)
    };
  }
  return __toCommonJS(index_exports);
})();
