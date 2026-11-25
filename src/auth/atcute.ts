/**
 * OAuthPort backed by @atcute/oauth-browser-client.
 *
 * Sessions (tokens + DPoP keys) are kept by the library in localStorage under
 * `storageName`, and synced across tabs.
 */
import {
  AuthorizationError,
  FetchResponseError,
  LoginError,
  OAuthResponseError,
  OAuthUserAgent,
  ResolverError,
  TokenRefreshError,
  configureOAuth,
  createAuthorizationUrl,
  deleteStoredSession,
  finalizeAuthorization,
  getSession,
  listStoredSessions,
  type Session,
} from '@atcute/oauth-browser-client';
import {
  CompositeDidDocumentResolver,
  LocalActorResolver,
  PlcDidDocumentResolver,
  WebDidDocumentResolver,
  XrpcHandleResolver,
} from '@atcute/identity-resolver';
import type { AuthIssueCode } from './contract';
import type { OAuthPort, Phase, PortSession } from './port';

type SessionDid = Parameters<typeof getSession>[0];
type Identifier = Parameters<LocalActorResolver['resolve']>[0];

export interface AtcuteConfig {
  /** URL of the public client-metadata.json, or a loopback id from `loopbackClientId` in dev. */
  clientId: string;
  /** Must be listed in the client metadata's redirect_uris. */
  redirectUri: string;
  /** localStorage key prefix. Default 'sociallens-oauth'. */
  storageName?: string;
  /** Resolves handles to DIDs (browsers can't do DNS). Default the public Bluesky AppView. */
  handleResolverUrl?: string;
  /** PLC directory. Default https://plc.directory. */
  plcUrl?: string;
}

export const DEFAULT_STORAGE_NAME = 'sociallens-oauth';

/**
 * Development client id: AT Protocol OAuth accepts `http://localhost?...` as
 * a client without hosted metadata. `redirectUri` must use 127.0.0.1, not localhost.
 */
export function loopbackClientId(redirectUri: string, scope: string): string {
  return `http://localhost?redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(scope)}`;
}

/** Map an error from the library, the resolver or fetch to an issue code. Exported for tests. */
export function classifyError(err: unknown, phase: Phase): { code: AuthIssueCode; retryable: boolean } {
  if (err instanceof AuthorizationError) {
    return err.error === 'access_denied'
      ? { code: 'cancelled', retryable: true }
      : { code: 'callback-failed', retryable: true };
  }
  if (err instanceof TokenRefreshError) return { code: 'session-expired', retryable: false };
  if (err instanceof LoginError) return { code: 'callback-failed', retryable: true };
  if (err instanceof ResolverError) return { code: 'resolution-failed', retryable: false };
  if (err instanceof OAuthResponseError) {
    const retryable = err.status >= 500 || err.status === 429;
    return { code: phase === 'callback' ? 'callback-failed' : 'unexpected', retryable };
  }
  if (err instanceof FetchResponseError) {
    return { code: phase === 'sign-in' ? 'resolution-failed' : 'unexpected', retryable: err.status >= 500 };
  }
  if (err instanceof Error) {
    if (err.name === 'TimeoutError' || err.name === 'AbortError') return { code: 'timeout', retryable: true };
    if (err.name === 'SecurityError' || err.name === 'QuotaExceededError') {
      return { code: 'storage-unavailable', retryable: false };
    }
    // Identity-resolver errors (handle/DID document lookups).
    if (/HandleResolution|DidDocumentResolution|DidNotFound|DocumentNotFound|UnsupportedDidMethod|ImproperDid|AmbiguousHandle|InvalidResolvedHandle/.test(
      err.name,
    )) {
      return { code: 'resolution-failed', retryable: false };
    }
    // fetch() network failures are TypeErrors ("Failed to fetch", "fetch failed", "Load failed").
    if (err instanceof TypeError && /fetch|network|load failed/i.test(err.message)) {
      return { code: 'network', retryable: true };
    }
    // The library also throws TypeErrors for protocol violations (e.g. issuer mismatch).
    if (phase === 'callback') return { code: 'callback-failed', retryable: true };
  }
  return { code: 'unexpected', retryable: false };
}

function toPortSession(session: Session): PortSession {
  const agent = new OAuthUserAgent(session);
  return {
    did: session.info.sub,
    pdsUrl: new URL(session.info.aud).origin,
    authServer: session.info.server.issuer,
    scopes: session.token.scope.split(' ').filter(Boolean),
    handle: (pathAndQuery, init) => agent.handle(pathAndQuery, init),
  };
}

/**
 * The real OAuth client. Talks to the account's PDS and authorization server,
 * plc.directory / did:web hosts, and the AppView (handle lookups only).
 * The library is configured on first use; if storage is blocked, calls fail
 * with a SecurityError that classifies as `storage-unavailable`.
 */
export function createAtcutePort(config: AtcuteConfig): OAuthPort {
  const resolver = new LocalActorResolver({
    handleResolver: new XrpcHandleResolver({ serviceUrl: config.handleResolverUrl ?? 'https://public.api.bsky.app' }),
    didDocumentResolver: new CompositeDidDocumentResolver({
      methods: {
        plc: new PlcDidDocumentResolver(config.plcUrl ? { apiUrl: config.plcUrl } : {}),
        web: new WebDidDocumentResolver(),
      },
    }),
  });

  let configured: unknown = null; // null: not yet; true: ok; otherwise the error
  function ready() {
    if (configured === null) {
      try {
        configureOAuth({
          metadata: { client_id: config.clientId, redirect_uri: config.redirectUri },
          identityResolver: resolver,
          storageName: config.storageName ?? DEFAULT_STORAGE_NAME,
        });
        configured = true;
      } catch (err) {
        configured = err;
      }
    }
    if (configured !== true) {
      const e = new Error('storage unavailable');
      e.name = 'SecurityError';
      throw e;
    }
  }

  const port: OAuthPort = {
    async authorizationUrl(identifier, scope) {
      ready();
      const url = await createAuthorizationUrl({
        target: { type: 'account', identifier: identifier as Identifier },
        scope,
      });
      return url.href;
    },

    async finalize(params) {
      ready();
      const { session } = await finalizeAuthorization(params);
      return toPortSession(session);
    },

    async restore(did) {
      ready();
      return toPortSession(await getSession(did as SessionDid, { allowStale: true }));
    },

    storedDids() {
      try {
        ready();
        return listStoredSessions();
      } catch {
        return [];
      }
    },

    async resolveHandle(did) {
      try {
        const r = await resolver.resolve(did as Identifier);
        return r.handle && r.handle !== 'handle.invalid' ? r.handle : null;
      } catch {
        return null;
      }
    },

    async isAlive(did) {
      try {
        ready();
        await getSession(did as SessionDid);
        return true;
      } catch (err) {
        return !(err instanceof TokenRefreshError);
      }
    },

    async signOut(did) {
      ready();
      try {
        const session = await getSession(did as SessionDid, { allowStale: true });
        await new OAuthUserAgent(session).signOut();
      } finally {
        port.forget(did);
      }
    },

    forget(did) {
      try {
        ready();
        deleteStoredSession(did as SessionDid);
      } catch {
        // Nothing stored, or storage unavailable: nothing to forget.
      }
    },

    classify: classifyError,
  };
  return port;
}
