// Registry: which apps we know about, and how to group a repo's collections by app.
// Pure code, no network, no URLs.

import type { AppEntry, KnownApp } from "./types.ts";

// Collection prefixes for apps we recognize. Verify each prefix in pdsls.dev
// before relying on it. Only `supported: true` apps are requested from the adapters.
export const KNOWN_APPS: KnownApp[] = [
  { id: "app.bsky", name: "Bluesky", supported: true },
  { id: "chat.bsky", name: "Bluesky (chat settings)", supported: false },
  { id: "site.standard", name: "Standard.site", supported: false },
  { id: "pub.leaflet", name: "Leaflet", supported: false },
  { id: "sh.tangled", name: "Tangled", supported: false },
  { id: "blue.linkat", name: "Linkat", supported: false },
];

const BY_ID = new Map(KNOWN_APPS.map((a) => [a.id, a]));

/** "app.bsky.feed.post" -> "app.bsky" (first two segments = the app's domain, reversed). */
export function appIdOf(nsid: string): string {
  return nsid.split(".").slice(0, 2).join(".");
}

/** "pub.leaflet" -> "leaflet.pub", the display name for apps we don't know. */
export function domainOf(appId: string): string {
  return appId.split(".").reverse().join(".");
}

export function lookupApp(appId: string): KnownApp {
  return BY_ID.get(appId) ?? { id: appId, name: domainOf(appId), supported: false };
}

/**
 * Group one repo's collections into apps.
 * Order: supported, then known-but-unsupported, then unknown; alphabetical within each.
 */
export function buildRegistry(collections: string[]): AppEntry[] {
  const groups = new Map<string, string[]>();
  for (const nsid of collections) {
    const id = appIdOf(nsid);
    groups.set(id, [...(groups.get(id) ?? []), nsid]);
  }
  const rank = (a: AppEntry) => (a.supported ? 0 : BY_ID.has(a.id) ? 1 : 2);
  return [...groups.entries()]
    .map(([id, cols]): AppEntry => {
      const app = lookupApp(id);
      return { id, name: app.name, supported: app.supported, collections: [...cols].sort() };
    })
    .sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}

/** The collections to put in AdapterRequest.collections: every collection of a supported app. */
export function collectionsToRequest(apps: AppEntry[]): string[] {
  return apps.filter((a) => a.supported).flatMap((a) => a.collections);
}