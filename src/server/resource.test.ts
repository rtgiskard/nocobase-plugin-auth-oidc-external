import type { Context } from '@nocobase/actions';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AUTH_TYPE, EXCHANGE_ACTION } from '../shared/constants';
import { getAuthenticator, registerActions } from './resource';

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

import { buildAuthorizationRequest, handleAuthorizationCallback } from './oidc';
import { consumeCallbackTicket, consumeOIDCState, saveCallbackTicket, saveOIDCState } from './state-store';

describe('getAuthenticator', () => {
  it('only loads enabled OIDC authenticators', async () => {
    let requestedFilter: unknown;
    const ctx = {
      db: {
        getRepository: (name: string) => {
          expect(name).toBe('authenticators');
          return {
            findOne: async (query: unknown) => {
              requestedFilter = query;
              return {
                toJSON: () => ({ name: 'oidc', authType: AUTH_TYPE, enabled: true }),
              };
            },
          };
        },
      },
      throw: (status: number, message: string) => {
        throw new Error(`${status} ${message}`);
      },
    } as unknown as Context;

    await expect(getAuthenticator(ctx, 'oidc')).resolves.toMatchObject({ name: 'oidc', authType: AUTH_TYPE });
    expect(requestedFilter).toEqual({ filter: { name: 'oidc', enabled: true } });
  });

  it('rejects missing or disabled authenticators', async () => {
    const ctx = {
      db: {
        getRepository: (name: string) => {
          expect(name).toBe('authenticators');
          return {
            findOne: async () => null,
          };
        },
      },
      throw: (status: number, message: string) => {
        throw new Error(`${status} ${message}`);
      },
    } as unknown as Context;

    await expect(getAuthenticator(ctx, 'oidc')).rejects.toThrow('404 Authenticator is not found');
  });
});

describe('registerActions exchange', () => {
  const buildAuthorizationRequestMock = vi.mocked(buildAuthorizationRequest);
  const consumeOIDCStateMock = vi.mocked(consumeOIDCState);
  const handleAuthorizationCallbackMock = vi.mocked(handleAuthorizationCallback);
  const consumeCallbackTicketMock = vi.mocked(consumeCallbackTicket);
  const saveCallbackTicketMock = vi.mocked(saveCallbackTicket);
  const saveOIDCStateMock = vi.mocked(saveOIDCState);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  function getActions() {
    let actions: Record<string, (ctx: Context, next: () => Promise<void>) => Promise<void>> = {};
    registerActions(
      {
        resourceManager: {
          define: (resource: { actions: Record<string, (ctx: Context, next: () => Promise<void>) => Promise<void>> }) => {
            actions = resource.actions;
          },
        },
      } as never,
      'oidc-external',
    );
    return actions;
  }

  it('refreshes existing flow cookie and sets no-store headers in getAuthUrl', async () => {
    const actions = getActions();
    buildAuthorizationRequestMock.mockResolvedValue({
      url: new URL('https://issuer.test/authorize?state=s1'),
      state: 'state-1',
      nonce: 'nonce-1',
      codeVerifier: 'verifier-1',
    });

    const cookieSet = vi.fn();
    const ctx = {
      action: {
        params: {
          values: {
            authenticator: 'oidc',
            binding: 'binding-1',
            callbackPath: '/nocobase/v/oidc-external/callback',
            redirectTo: '/nocobase/v/admin?keep=1',
          },
        },
      },
      cookies: {
        get: (name: string) => (name === 'oidc_external_flow' ? 'existing-flow-cookie' : undefined),
        set: cookieSet,
      },
      app: { cache: {} },
      db: {
        getRepository: () => ({
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
        }),
      },
      secure: true,
      set: vi.fn(),
      throw: (status: number, message: string) => {
        throw new Error(`${status} ${message}`);
      },
    } as unknown as Context;

    await actions.getAuthUrl(ctx, async () => undefined);

    expect(cookieSet).toHaveBeenCalledWith('oidc_external_flow', 'existing-flow-cookie', {
      httpOnly: true,
      sameSite: 'lax',
      secure: true,
      path: '/',
      maxAge: 600000,
      overwrite: true,
    });
    expect(saveOIDCStateMock).toHaveBeenCalledWith(
      expect.anything(),
      'state-1',
      expect.objectContaining({
        callbackPath: '/nocobase/v/oidc-external/callback',
        flowCookieHash: 'hash:existing-flow-cookie',
        redirectTo: '/nocobase/v/admin?keep=1',
      }),
    );
    expect(ctx.set).toHaveBeenCalledWith('Cache-Control', 'no-store');
    expect(ctx.set).toHaveBeenCalledWith('Pragma', 'no-cache');
  });

  it('sets callback ticket cookie with explicit path and no-store headers in redirect', async () => {
    const actions = getActions();
    consumeOIDCStateMock.mockResolvedValue({
      authenticator: 'oidc',
      codeVerifier: 'code-verifier',
      nonce: 'nonce',
      redirectTo: '/admin?keep=1',
      callbackPath: '/nocobase/v/oidc-external/callback',
      flowCookieHash: 'hash:flow-cookie',
      clientBindingHash: 'hash:binding-1',
      createdAt: Date.now(),
    });
    handleAuthorizationCallbackMock.mockResolvedValue({
      claims: { iss: 'https://issuer.test', sub: 'user-1' },
    });

    const cookieSet = vi.fn();
    const redirect = vi.fn();
    const ctx = {
      query: { state: 'state-1' },
      querystring: 'state=state-1&code=code-1',
      cookies: {
        get: (name: string) => (name === 'oidc_external_flow' ? 'flow-cookie' : undefined),
        set: cookieSet,
      },
      app: { cache: {} },
      db: {
        getRepository: () => ({
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
        }),
      },
      redirect,
      secure: false,
      set: vi.fn(),
      throw: (status: number, message: string) => {
        throw new Error(`${status} ${message}`);
      },
    } as unknown as Context;

    await actions.redirect(ctx, async () => undefined);

    expect(saveCallbackTicketMock).toHaveBeenCalledTimes(1);
    expect(cookieSet).toHaveBeenCalledWith(
      'oidc_external_callback_ticket',
      expect.any(String),
      {
        httpOnly: true,
        sameSite: 'lax',
        secure: false,
        path: '/',
        maxAge: 120000,
        overwrite: true,
      },
    );
    expect(ctx.set).toHaveBeenCalledWith('Cache-Control', 'no-store');
    expect(ctx.set).toHaveBeenCalledWith('Pragma', 'no-cache');
    expect(redirect).toHaveBeenCalledWith('/nocobase/v/oidc-external/callback?oidc_external=callback');
  });

  it('exposes exchange action and exchanges ticket for token', async () => {
    const actions = getActions();

    expect(actions[EXCHANGE_ACTION]).toBeTypeOf('function');

    consumeCallbackTicketMock.mockResolvedValue({
      authenticator: 'oidc',
      claims: { iss: 'https://issuer.test', sub: 'user-1' },
      redirectTo: '/v/admin?keep=1',
      flowCookieHash: 'hash:flow-cookie',
      clientBindingHash: 'hash:binding-1',
      createdAt: Date.now(),
    });

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

    expect(signIn).toHaveBeenCalledTimes(1);
    expect(ctx.set).toHaveBeenCalledWith('Cache-Control', 'no-store');
    expect(ctx.set).toHaveBeenCalledWith('Pragma', 'no-cache');
    expect(ctx.cookies.set).toHaveBeenCalledWith('oidc_external_callback_ticket', '', {
      httpOnly: true,
      sameSite: 'lax',
      secure: undefined,
      path: '/',
      maxAge: 0,
      overwrite: true,
    });
    expect(ctx.body).toEqual({ authenticator: 'oidc', token: 'jwt-token', redirectTo: '/v/admin?keep=1' });
  });
});
