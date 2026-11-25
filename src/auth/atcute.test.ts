import { describe, expect, it } from 'vitest';
import {
  AuthorizationError,
  FetchResponseError,
  LoginError,
  OAuthResponseError,
  ResolverError,
  TokenRefreshError,
} from '@atcute/oauth-browser-client';
import { classifyError, loopbackClientId } from './atcute';

const did = 'did:plc:fixture-alice' as ConstructorParameters<typeof TokenRefreshError>[0];

function named(name: string, message = name) {
  const e = new Error(message);
  e.name = name;
  return e;
}

describe('classifyError', () => {
  it.each([
    ['denied consent', new AuthorizationError('access_denied'), 'callback', 'cancelled'],
    ['other authorization error', new AuthorizationError('server_error'), 'callback', 'callback-failed'],
    ['unknown state (replayed/old link)', new LoginError('unknown state provided'), 'callback', 'callback-failed'],
    ['refresh failed', new TokenRefreshError(did, 'session was revoked'), 'request', 'session-expired'],
    ['bad auth server', new ResolverError('unexpected issuer'), 'sign-in', 'resolution-failed'],
    ['token endpoint error during callback', new OAuthResponseError(new Response('', { status: 400 }), {}), 'callback', 'callback-failed'],
    ['metadata fetch error on sign-in', new FetchResponseError(new Response('', { status: 404 }), 404, 'x'), 'sign-in', 'resolution-failed'],
    ['handle not found', named('DidNotFoundError'), 'sign-in', 'resolution-failed'],
    ['DID document missing', named('DocumentNotFoundError'), 'sign-in', 'resolution-failed'],
    ['offline', new TypeError('Failed to fetch'), 'sign-in', 'network'],
    ['timeout', named('TimeoutError'), 'sign-in', 'timeout'],
    ['storage blocked', named('SecurityError'), 'restore', 'storage-unavailable'],
    ['issuer mismatch (TypeError from the library)', new TypeError('issuer mismatch; got x'), 'callback', 'callback-failed'],
    ['anything else', 'weird', 'request', 'unexpected'],
  ] as const)('%s -> %s', (_label, err, phase, code) => {
    expect(classifyError(err, phase).code).toBe(code);
  });

  it('marks server-side 5xx/429 as retryable and 4xx as not', () => {
    expect(classifyError(new OAuthResponseError(new Response('', { status: 503 }), {}), 'callback').retryable).toBe(true);
    expect(classifyError(new OAuthResponseError(new Response('', { status: 429 }), {}), 'callback').retryable).toBe(true);
    expect(classifyError(new OAuthResponseError(new Response('', { status: 400 }), {}), 'callback').retryable).toBe(false);
  });
});

describe('loopbackClientId', () => {
  it('encodes the redirect and scope into a localhost client id', () => {
    expect(loopbackClientId('http://127.0.0.1:5173/', 'atproto')).toBe(
      'http://localhost?redirect_uri=http%3A%2F%2F127.0.0.1%3A5173%2F&scope=atproto',
    );
  });
});
