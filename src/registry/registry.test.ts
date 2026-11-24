// Offline tests for loadAccounts over a fake network. Run with: npm test
import { describe, expect, it } from "vitest";
import { appIdOf, buildRegistry, collectionsToRequest, loadAccounts, lookupApp } from "./index";
import type { AuthInput } from "./types";

// ---------- fake identities (fixture names only) ----------

const SELF = "did:plc:fixtureself";
const BRAND = "did:plc:fixturebrand";     // links back -> verified
const PENDING = "did:plc:fixturepending"; // doesn't link back -> pending
const GONE = "did:plc:fixturegone";       // DID can't be resolved -> skipped with an issue
const PDS = "https://pds.fixture.test";
const LINK = "app.sociallens.linkedAccount";
const enc = encodeURIComponent;

const plcDoc = (handle: string) => ({
    alsoKnownAs: [`at://${handle}`],
    service: [{ id: "#atproto_pds", type: "AtprotoPersonalDataServer", serviceEndpoint: PDS }],
});

// ---------- fake network ----------

const routes: Record<string, unknown> = {
  [`${PDS}/xrpc/com.atproto.repo.describeRepo?repo=${enc(SELF)}`]: {
    collections: ["app.bsky.feed.post", "app.bsky.feed.like", "site.standard.document", "pub.leaflet.document", LINK, "com.example.thing"],
  },
  [`${PDS}/xrpc/com.atproto.repo.listRecords?repo=${enc(SELF)}&collection=${LINK}&limit=10`]: {
    records: [{ value: { did: BRAND } }, { value: { did: PENDING } }, { value: { did: GONE } }],
  },
  [`https://plc.directory/${BRAND}`]: plcDoc("brand.fixture.test"),
  [`https://plc.directory/${PENDING}`]: plcDoc("pending.fixture.test"),
  [`${PDS}/xrpc/com.atproto.repo.getRecord?repo=${enc(BRAND)}&collection=${LINK}&rkey=${enc(SELF)}`]: { value: { did: SELF } },
  [`${PDS}/xrpc/com.atproto.repo.describeRepo?repo=${enc(BRAND)}`]: { collections: ["app.bsky.feed.post", "app.bsky.feed.repost"] },
  [`${PDS}/xrpc/com.atproto.repo.describeRepo?repo=${enc(PENDING)}`]: { collections: ["app.bsky.feed.post"] },
};

/** Answers from `routes`; anything else is a 404. */
const fakeFetch = (async (url: string) => {
  const body = routes[url];
  return body ? new Response(JSON.stringify(body), { status: 200 }) : new Response("{}", { status: 404 });
}) as typeof fetch;

/** Every request fails with 503. */
const downFetch = (async () => new Response("{}", { status: 503 })) as typeof fetch;

// ---------- fake sign-in ----------

const sessionFetch = (async () => new Response("{}")) as typeof fetch; // stands in for the OAuth fetch
const auth: AuthInput = {
  info: {
    status: "signed-in",
    did: SELF,
    handle: "self.fixture.test",
    pdsUrl: PDS,
    authServer: "https://auth.fixture.test",
    scopes: ["atproto"],
    signedInAt: "2026-01-01T00:00:00.000Z",
  },
  fetch: sessionFetch,
};

// ---------- tests with fake network, accounts.ts ----------

describe("loadAccounts: typical", async () => {
  const out = await loadAccounts(auth, { fetch: fakeFetch, adapterOptions: { maxRecordsPerCollection: 500 } });
  const [self, brand, pending] = out.accounts;

  it("returns self, verified and pending accounts in that order", () => {
    expect(out.schemaVersion).toBe(1);
    expect(out.accounts.map((a) => a.verification)).toEqual(["self", "verified", "pending"]);
  });

  it("groups the signed-in repo into apps, supported first", () => {
    expect(self?.apps.map((a) => a.id)).toEqual(["app.bsky", "pub.leaflet", "site.standard", "com.example", "app.sociallens"]);
  });

  it("requests only supported apps' collections", () => {
    expect(self?.request?.collections).toEqual(["app.bsky.feed.like", "app.bsky.feed.post"]);
  });

  it("gives only the signed-in account a session, with the auth fetch", () => {
    expect(self?.request?.session?.did).toBe(SELF);
    expect(self?.request?.session?.fetch).toBe(sessionFetch);
    expect(brand?.request?.session).toBeUndefined();
  });

  it("copies adapter options into the request", () => {
    expect(self?.request?.options?.maxRecordsPerCollection).toBe(500);
  });

  it("builds a request for verified linked accounts", () => {
    expect(brand?.request?.collections).toEqual(["app.bsky.feed.post", "app.bsky.feed.repost"]);
  });

  it("gives pending accounts no apps and no request", () => {
    expect(pending?.apps).toEqual([]);
    expect(pending?.request).toBeNull();
  });

  it("reports an unresolvable account as one warning with no URL", () => {
    expect(out.issues).toHaveLength(1);
    expect(out.issues[0]?.code).toBe("not-found");
    expect(out.issues[0]?.severity).toBe("warning");
    expect(out.issues[0]?.message).not.toMatch(/https?:/);
    expect(out.complete).toBe(false);
  });
});

describe("loadAccounts: data server down", async () => {
  const out = await loadAccounts(auth, { fetch: downFetch });

  it("never rejects and keeps the signed-in account", () => {
    expect(out.accounts).toHaveLength(1);
    expect(out.accounts[0]?.verification).toBe("self");
  });

  it("omits collections so the adapter discovers them", () => {
    expect(out.accounts[0]?.request?.collections).toBeUndefined();
  });

  it("reports retryable http errors and is incomplete", () => {
    expect(out.issues.length).toBeGreaterThan(0);
    expect(out.issues.every((i) => i.code === "http-error" && i.retryable)).toBe(true);
    expect(out.complete).toBe(false);
  });
});

// ---------- tests with fake network, registry.ts ----------

describe("registry: appIdOf", () => {
  it("keeps the first two segments of a collection name", () => {
    expect(appIdOf("app.bsky.feed.post")).toBe("app.bsky");
    expect(appIdOf("pub.leaflet.document")).toBe("pub.leaflet");
  });
});

describe("registry: lookupApp", () => {
  it("returns known apps from KNOWN_APPS", () => {
    expect(lookupApp("app.bsky")).toEqual({ id: "app.bsky", name: "Bluesky", supported: true });
  });

  it("names unknown apps by their domain and marks them unsupported", () => {
    expect(lookupApp("com.example")).toEqual({ id: "com.example", name: "example.com", supported: false });
  });
});

describe("registry: buildRegistry", () => {
  it("returns no apps for an empty repo", () => {
    expect(buildRegistry([])).toEqual([]);
  });

  it("groups one app's collections into one entry, sorted", () => {
    expect(buildRegistry(["app.bsky.feed.post", "app.bsky.feed.like"])).toEqual([
      { id: "app.bsky", name: "Bluesky", supported: true, collections: ["app.bsky.feed.like", "app.bsky.feed.post"] },
    ]);
  });

  it("orders supported, then known, then unknown apps, alphabetical within each", () => {
    const apps = buildRegistry([
      "com.zeta.thing",
      "site.standard.document",
      "com.example.thing",
      "pub.leaflet.document",
      "app.bsky.feed.post",
    ]);
    expect(apps.map((a) => a.id)).toEqual(["app.bsky", "pub.leaflet", "site.standard", "com.example", "com.zeta"]);
  });
});

describe("registry: collectionsToRequest", () => {
  it("returns only supported apps' collections", () => {
    const apps = buildRegistry(["app.bsky.feed.post", "app.bsky.feed.like", "pub.leaflet.document", "com.example.thing"]);
    expect(collectionsToRequest(apps)).toEqual(["app.bsky.feed.like", "app.bsky.feed.post"]);
  });

  it("returns nothing when no app is supported", () => {
    expect(collectionsToRequest(buildRegistry(["pub.leaflet.document"]))).toEqual([]);
  });
});