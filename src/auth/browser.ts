/**
 * Wires the auth service to the real browser: window.location, history,
 * localStorage and cross-tab storage events. The only file that touches
 * browser globals; everything else gets them injected.
 */
import type { AuthService } from './contract';
import { createAtcutePort, DEFAULT_STORAGE_NAME, type AtcuteConfig } from './atcute';
import { createAuth, META_KEY, type AuthStorage } from './service';

export interface BrowserAuthConfig extends AtcuteConfig {
  /** OAuth scope. Default 'atproto' (identity only, read-only). */
  scope?: string;
}

function localStorageOrNull(): AuthStorage | null {
  try {
    const s = window.localStorage;
    const probe = `${META_KEY}:probe`;
    s.setItem(probe, '1');
    s.removeItem(probe);
    return s;
  } catch {
    return null;
  }
}

/** The auth service for the app. Call `init()` on every page load, including the redirect page. */
export function createBrowserAuth(config: BrowserAuthConfig): AuthService {
  const storageName = config.storageName ?? DEFAULT_STORAGE_NAME;
  return createAuth({
    oauth: createAtcutePort(config),
    storage: localStorageOrNull(),
    scope: config.scope,
    location: {
      href: () => window.location.href,
      replace: (url) => window.history.replaceState(null, '', url),
      assign: (url) => window.location.assign(url),
    },
    watchExternal(onChange) {
      // Fired in OTHER tabs when this origin's localStorage changes.
      const h = (e: StorageEvent) => {
        if (e.key === null || e.key.startsWith(storageName) || e.key === META_KEY) onChange();
      };
      window.addEventListener('storage', h);
      return () => window.removeEventListener('storage', h);
    },
  });
}
