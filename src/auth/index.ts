/**
 * Auth module: public API.
 *
 *   const auth = createBrowserAuth({ clientId, redirectUri });
 *   await auth.init();
 *
 * Types live in ./contract. `createAuth` (with injected dependencies) is
 * exported for tests and for wiring a different OAuth client.
 */
export * from './contract';
export { createBrowserAuth, type BrowserAuthConfig } from './browser';
export { createAuth, normalizeIdentifier, DEFAULT_SCOPE, type AuthDeps, type AuthLocation, type AuthStorage } from './service';
export { createAtcutePort, loopbackClientId, type AtcuteConfig } from './atcute';
export type { OAuthPort, PortSession, Phase } from './port';
