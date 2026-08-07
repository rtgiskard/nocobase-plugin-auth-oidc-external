import type { Context } from '@nocobase/actions';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AUTH_TYPE, EXCHANGE_ACTION } from '../shared/constants';
import { registerActions } from './resource';

vi.mock('openid-client', () => ({
  randomPKCECodeVerifier: vi.fn(() => 'callback-ticket'),
}));

vi.mock('./state-store', () => ({
  consumeCallbackTicket: vi.fn(),
  consumeOIDCState: vi.fn(),
  saveCallbackTicket: vi.fn(),
  saveOIDCState: vi.fn(),
  sha256Base64Url: vi.fn((value: string) => `hash:${value}`),
}));

vi.mock('./oidc', () => ({
  buildAuthorizationRequest: vi.fn(),
  handleAuthorizationCallback: vi.fn(),
}));

import { handleAuthorizationCallback } from './oidc';
import { consumeCallbackTicket, consumeOIDCState, saveCallbackTicket } from './state-store';

type Action = (ctx: Context, next: () => Promise<void>) => Promise<void>;

function getActions(): Record<string, Action> {
  let actions: Record<string, Action> = {};
  registerActions(
    {
      resourceManager: {
        define: (resource: { actions: Record<string, Action> }) => {
          actions = resource.actions;
        },
      },
    } as never,
    'oidc-external',
  );
  return actions;
}

function authenticatorRepository() {
  return {
    findOne: async () => ({
      toJSON: () => ({
        name: 'oidc',
        authType: AUTH_TYPE,
        enabled: true,
        options: {
          clientId: 'client-id',
          clientSecret: 'client-secret',
          redirectUri: 'https://nocobase.example.com/api/oidc-external:redirect',
        },
      }),
    }),
  };
}

describe('latest-v2 callback redirect protocol', () => {
  const consumeCallbackTicketMock = vi.mocked(consumeCallbackTicket);
  const consumeOIDCStateMock = vi.mocked(consumeOIDCState);
  const handleAuthorizationCallbackMock = vi.mocked(handleAuthorizationCallback);
  const saveCallbackTicketMock = vi.mocked(saveCallbackTicket);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('redirects to the state-bound prefixed callback and retains the sanitized target in the ticket', async () => {
    const actions = getActions();
    consumeOIDCStateMock.mockResolvedValue({
      authenticator: 'oidc',
      codeVerifier: 'code-verifier',
      nonce: 'nonce',
      redirectTo: '/v/admin?keep=1&token=url-token&code=url-code&state=url-state&ticket=url-ticket',
      callbackPath: '/nocobase/v/oidc-external/callback',
      flowCookieHash: 'hash:flow-cookie',
      clientBindingHash: 'hash:binding-1',
      createdAt: Date.now(),
    });
    handleAuthorizationCallbackMock.mockResolvedValue({
      claims: { iss: 'https://issuer.test', sub: 'user-1' },
    });

    const redirect = vi.fn();
    const ctx = {
      query: { state: 'provider-state' },
      querystring: 'state=provider-state&code=provider-code',
      cookies: {
        get: (name: string) => (name === 'oidc_external_flow' ? 'flow-cookie' : undefined),
        set: vi.fn(),
      },
      app: { cache: {} },
      db: { getRepository: authenticatorRepository },
      redirect,
      secure: true,
      set: vi.fn(),
      throw: (status: number, message: string) => {
        throw new Error(`${status} ${message}`);
      },
    } as unknown as Context;

    await actions.redirect(ctx, async () => undefined);

    expect.soft(saveCallbackTicketMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(String),
      expect.objectContaining({
        authenticator: 'oidc',
        redirectTo: '/v/admin?keep=1',
      }),
    );
    expect.soft(redirect).toHaveBeenCalledWith('/nocobase/v/oidc-external/callback?oidc_external=callback');
    const frontendUrl = String(redirect.mock.calls[0]?.[0]);
    const callbackTicket = String(saveCallbackTicketMock.mock.calls[0]?.[1]);
    for (const sensitiveValue of [
      'provider-state',
      'provider-code',
      callbackTicket,
      'url-token',
      'url-code',
      'url-state',
      'url-ticket',
    ]) {
      expect(frontendUrl).not.toContain(sensitiveValue);
    }
  });

  it('uses the default callback for in-flight state created before callbackPath existed', async () => {
    // Given
    const actions = getActions();
    const legacyState = {
      authenticator: 'oidc',
      callbackPath: '/v/oidc-external/callback',
      codeVerifier: 'code-verifier',
      nonce: 'nonce',
      redirectTo: '/v/admin',
      flowCookieHash: 'hash:flow-cookie',
      clientBindingHash: 'hash:binding-1',
      createdAt: Date.now(),
    };
    Reflect.deleteProperty(legacyState, 'callbackPath');
    consumeOIDCStateMock.mockResolvedValue(legacyState);
    handleAuthorizationCallbackMock.mockResolvedValue({
      claims: { iss: 'https://issuer.test', sub: 'user-1' },
    });
    const redirect = vi.fn();
    const ctx = {
      query: { state: 'provider-state' },
      querystring: 'state=provider-state&code=provider-code',
      cookies: {
        get: (name: string) => (name === 'oidc_external_flow' ? 'flow-cookie' : undefined),
        set: vi.fn(),
      },
      app: { cache: {} },
      db: { getRepository: authenticatorRepository },
      redirect,
      secure: true,
      set: vi.fn(),
      throw: (status: number, message: string) => {
        throw new Error(`${status} ${message}`);
      },
    } as unknown as Context;

    // When
    await actions.redirect(ctx, async () => undefined);

    // Then
    expect(redirect).toHaveBeenCalledWith('/v/oidc-external/callback?oidc_external=callback');
  });

  it('returns authenticator, token, and the ticket target from exchange', async () => {
    const actions = getActions();
    const callbackTicket = {
      authenticator: 'oidc',
      claims: { iss: 'https://issuer.test', sub: 'user-1' },
      redirectTo: '/v/admin?tab=users#details',
      flowCookieHash: 'hash:flow-cookie',
      clientBindingHash: 'hash:binding-1',
      createdAt: Date.now(),
    };
    consumeCallbackTicketMock.mockResolvedValue(callbackTicket);

    const signIn = vi.fn().mockResolvedValue({ token: 'jwt-token' });
    const ctx = {
      action: { params: { values: { binding: 'binding-1' } } },
      cookies: {
        get: (name: string) => {
          if (name === 'oidc_external_callback_ticket') return 'ticket-1';
          if (name === 'oidc_external_flow') return 'flow-cookie';
          return undefined;
        },
        set: vi.fn(),
      },
      app: {
        authManager: {
          get: vi.fn().mockResolvedValue({ signIn }),
        },
      },
      throw: (status: number, message: string) => {
        throw new Error(`${status} ${message}`);
      },
      set: vi.fn(),
      state: {},
    } as unknown as Context;

    await actions[EXCHANGE_ACTION](ctx, async () => undefined);

    expect(ctx.body).toEqual({
      authenticator: 'oidc',
      token: 'jwt-token',
      redirectTo: '/v/admin?tab=users#details',
    });
  });
});
