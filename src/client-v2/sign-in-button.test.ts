import { isValidElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAndStorePendingOidcFlow } from './flow-binding';
import { frontendCallbackPathFrom, postSignInRedirectFrom } from './redirect-target';
import { ExternalOIDCSignInButton } from './sign-in-button';
import { PENDING_FLOW_STORAGE_KEY } from './storage';

const mocks = vi.hoisted(() => ({
  getAuthUrl: vi.fn(),
  getBasename: vi.fn(),
  messageError: vi.fn(),
}));

vi.mock('@nocobase/client-v2', () => ({
  useApp: () => ({
    apiClient: {
      auth: { locale: 'en' },
      resource: () => ({ getAuthUrl: mocks.getAuthUrl }),
    },
    router: { getBasename: mocks.getBasename },
  }),
}));

vi.mock('antd', () => ({
  App: { useApp: () => ({ message: { error: mocks.messageError } }) },
  Button: () => null,
}));

describe('createAndStorePendingOidcFlow', () => {
  it('stores a pending flow with generated binding and createdAt', () => {
    const setItem = vi.fn();
    const storage = { setItem } as unknown as Storage;
    const getRandomValues = vi.fn((bytes: Uint8Array) => {
      bytes.fill(1);
      return bytes;
    });

    vi.stubGlobal('crypto', { getRandomValues });
    const pending = createAndStorePendingOidcFlow(storage);

    expect(pending.binding).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(pending.createdAt).toBeTypeOf('number');
    expect(setItem).toHaveBeenCalledWith(PENDING_FLOW_STORAGE_KEY, JSON.stringify(pending));
  });
});

describe('ExternalOIDCSignInButton', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sends a callback path derived from the router basename', async () => {
    // Given
    mocks.getBasename.mockReturnValue('/nocobase/v/');
    mocks.getAuthUrl.mockResolvedValue({ data: { data: { url: 'https://issuer.test/authorize' } } });
    vi.stubGlobal('crypto', {
      getRandomValues: (bytes: Uint8Array) => {
        bytes.fill(1);
        return bytes;
      },
    });
    const assign = vi.fn();
    vi.stubGlobal('window', {
      location: {
        assign,
        hash: '',
        pathname: '/nocobase/v/signin',
        search: '?redirect=%2Fnocobase%2Fv%2Fadmin',
      },
      navigator: { language: 'en' },
      sessionStorage: { removeItem: vi.fn(), setItem: vi.fn() },
    });
    const rendered = ExternalOIDCSignInButton({
      authenticator: { authType: 'oidc-external', authTypeTitle: 'OIDC', name: 'oidc', options: {} },
    });
    const children = isValidElement<{ children: readonly unknown[] }>(rendered) ? rendered.props.children : [];
    const button = children[0];

    // When
    if (isValidElement<{ onClick: () => Promise<void> }>(button)) await button.props.onClick();

    // Then
    expect(mocks.getAuthUrl).toHaveBeenCalledWith({
      values: expect.objectContaining({
        callbackPath: '/nocobase/v/oidc-external/callback',
        redirectTo: '/nocobase/v/admin',
      }),
    });
    expect(assign).toHaveBeenCalledWith('https://issuer.test/authorize');
  });
});

describe('postSignInRedirectFrom', () => {
  it('uses the standard v2 sign-in redirect query as the post-login target', () => {
    // Given
    const location = { pathname: '/v/signin', search: '?redirect=%2Fv%2Fadmin%3Ftab%3Dusers', hash: '' };

    // When
    const redirectTo = postSignInRedirectFrom(location, '/v');

    // Then
    expect(redirectTo).toBe(
      '/v/admin?tab=users',
    );
  });

  it('uses a prefixed v2 sign-in redirect query as the post-login target', () => {
    // Given
    const location = {
      pathname: '/nocobase/v/signin',
      search: '?redirect=%2Fnocobase%2Fv%2Fadmin%3Ftab%3Dusers',
      hash: '',
    };

    // When
    const redirectTo = postSignInRedirectFrom(location, '/nocobase/v/');

    // Then
    expect(redirectTo).toBe(
      '/nocobase/v/admin?tab=users',
    );
  });

  it('falls back to admin when the sign-in redirect query is empty', () => {
    expect(postSignInRedirectFrom({ pathname: '/v/signin', search: '?redirect=', hash: '' }, '/v')).toBe('/admin');
  });

  it('keeps the current route outside the sign-in page', () => {
    expect(postSignInRedirectFrom({ pathname: '/v/admin', search: '?tab=users', hash: '#top' }, '/v')).toBe(
      '/v/admin?tab=users#top',
    );
  });
});

describe('frontendCallbackPathFrom', () => {
  it('builds the callback path from the standard v2 basename', () => {
    expect(frontendCallbackPathFrom('/v')).toBe('/v/oidc-external/callback');
  });

  it('builds the callback path from a trailing-slash prefixed basename', () => {
    expect(frontendCallbackPathFrom('/nocobase/v/')).toBe('/nocobase/v/oidc-external/callback');
  });
});
