import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CALLBACK_MARKER_PARAM, CALLBACK_MARKER_VALUE } from '../shared/constants';
import { completeOidcCallbackInBrowser, readPendingOidcFlow } from './callback';
import { createClientBinding } from './flow-binding';
import { PENDING_FLOW_STORAGE_KEY } from './storage';

describe('callback helpers', () => {
  it('reads pending flow shape from storage', () => {
    const storage = new Map<string, string>();
    const sessionStorage = {
      getItem: (key: string) => storage.get(key) ?? null,
    } as Storage;
    storage.set(PENDING_FLOW_STORAGE_KEY, JSON.stringify({ binding: 'binding-1', createdAt: 1 }));
    expect(readPendingOidcFlow(sessionStorage)).toEqual({ binding: 'binding-1', createdAt: 1 });
  });

  it('generates 256-bit base64url binding', () => {
    const bytes = new Uint8Array(32);
    bytes.fill(255);
    const binding = createClientBinding(bytes);
    expect(binding).toHaveLength(43);
    expect(binding).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

describe('completeOidcCallback', () => {
  const setAuthenticator = vi.fn();
  const setToken = vi.fn();
  const exchange = vi.fn();
  const request = vi.fn();
  const navigate = vi.fn();
  const replaceState = vi.fn();
  const getItem = vi.fn();
  const removeItem = vi.fn();

  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('exchanges callback using binding, sets auth, and cleans marker', async () => {
    getItem.mockReturnValue(JSON.stringify({ binding: 'binding-1', createdAt: Date.now() }));
    exchange.mockResolvedValue({
      data: { data: { authenticator: 'oidc', token: 'jwt-token', redirectTo: '/admin?tab=users#a' } },
    });
    request.mockResolvedValue({ data: { data: { id: 1 } } });

    await completeOidcCallbackInBrowser(
      {
        auth: { setAuthenticator, setToken },
        request,
        resource: () => ({ exchange }),
      },
      {
        location: {
          pathname: '/admin',
          search: `?tab=users&code=code&state=state&ticket=ticket&token=token&authenticator=oidc&${CALLBACK_MARKER_PARAM}=${CALLBACK_MARKER_VALUE}`,
          hash: '#a',
        },
        history: { replaceState, state: null },
        sessionStorage: {
          getItem,
          removeItem,
          setItem: vi.fn(),
          clear: vi.fn(),
          key: vi.fn(),
          length: 0,
        },
      },
      'title',
      navigate,
    );

    expect(replaceState).toHaveBeenCalledWith(null, 'title', '/admin?tab=users#a');
    expect(exchange).toHaveBeenCalledWith({ values: { binding: 'binding-1' } });
    expect(setAuthenticator).toHaveBeenCalledWith('oidc');
    expect(setToken).toHaveBeenCalledWith('jwt-token');
    expect(request).toHaveBeenCalledWith({ url: '/auth:check', skipAuth: true, skipNotify: true });
    expect(navigate).toHaveBeenCalledWith('/admin?tab=users#a', { replace: true });
    expect(removeItem).toHaveBeenCalledWith(PENDING_FLOW_STORAGE_KEY);
  });

  it('checks auth after setting credentials then navigates without hard reloading the protected target', async () => {
    // Given
    const events: string[] = [];
    getItem.mockReturnValue(JSON.stringify({ binding: 'binding-1', createdAt: Date.now() }));
    exchange.mockImplementation(async () => {
      events.push('exchange');
      return {
        data: {
          data: {
            authenticator: 'oidc',
            token: 'jwt-token',
            redirectTo: '/v/admin?tab=users#details',
          },
        },
      };
    });
    setAuthenticator.mockImplementation(() => events.push('authenticator'));
    setToken.mockImplementation(() => events.push('token'));
    request.mockImplementation(async () => {
      events.push('check');
      return { data: { data: { id: 1 } } };
    });
    navigate.mockImplementation(() => events.push('navigate'));

    // When
    const apiClient = {
      auth: { setAuthenticator, setToken },
      request,
      resource: () => ({ exchange }),
    };
    const browser = {
      location: {
        pathname: '/v/oidc-external/callback',
        search: `?${CALLBACK_MARKER_PARAM}=${CALLBACK_MARKER_VALUE}`,
        hash: '',
      },
      history: { replaceState, state: null },
      sessionStorage: {
        getItem,
        removeItem,
        setItem: vi.fn(),
        clear: vi.fn(),
        key: vi.fn(),
        length: 0,
      },
    };

    await completeOidcCallbackInBrowser(apiClient, browser, 'title', navigate);

    // Then
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({ url: '/auth:check', skipAuth: true, skipNotify: true }),
    );
    expect(navigate).toHaveBeenCalledWith('/admin?tab=users#details', { replace: true });
    expect(events).toEqual(['exchange', 'authenticator', 'token', 'check', 'navigate']);
  });

  it('clears provisional credentials when the auth check fails', async () => {
    getItem.mockReturnValue(JSON.stringify({ binding: 'binding-1', createdAt: Date.now() }));
    exchange.mockResolvedValue({
      data: { data: { authenticator: 'oidc', token: 'jwt-token', redirectTo: '/v/admin' } },
    });
    request.mockRejectedValue(new Error('Unauthorized'));

    await expect(
      completeOidcCallbackInBrowser(
        {
          auth: { setAuthenticator, setToken },
          request,
          resource: () => ({ exchange }),
        },
        {
          location: {
            pathname: '/v/oidc-external/callback',
            search: `?${CALLBACK_MARKER_PARAM}=${CALLBACK_MARKER_VALUE}`,
            hash: '',
          },
          history: { replaceState, state: null },
          sessionStorage: {
            getItem,
            removeItem,
            setItem: vi.fn(),
            clear: vi.fn(),
            key: vi.fn(),
            length: 0,
          },
        },
        'title',
        navigate,
      ),
    ).rejects.toThrow('Unauthorized');

    expect(setToken).toHaveBeenNthCalledWith(1, 'jwt-token');
    expect(setToken).toHaveBeenNthCalledWith(2, '');
    expect(setAuthenticator).toHaveBeenNthCalledWith(1, 'oidc');
    expect(setAuthenticator).toHaveBeenNthCalledWith(2, '');
    expect(navigate).not.toHaveBeenCalled();
    expect(removeItem).toHaveBeenCalledWith(PENDING_FLOW_STORAGE_KEY);
  });

  it('removes expired pending flow without exchanging', async () => {
    const now = Date.now();
    getItem.mockReturnValue(JSON.stringify({ binding: 'binding-1', createdAt: now - (10 * 60 * 1000) - 1 }));

    await completeOidcCallbackInBrowser(
      {
        auth: { setAuthenticator, setToken },
        request,
        resource: () => ({ exchange }),
      },
      {
        location: {
          pathname: '/admin',
          search: `?tab=users&${CALLBACK_MARKER_PARAM}=${CALLBACK_MARKER_VALUE}`,
          hash: '#a',
        },
        history: { replaceState, state: null },
        sessionStorage: {
          getItem,
          removeItem,
          setItem: vi.fn(),
          clear: vi.fn(),
          key: vi.fn(),
          length: 0,
        },
      },
      'title',
      navigate,
    );

    expect(replaceState).toHaveBeenCalledWith(null, 'title', '/admin?tab=users#a');
    expect(removeItem).toHaveBeenCalledWith(PENDING_FLOW_STORAGE_KEY);
    expect(exchange).not.toHaveBeenCalled();
    expect(setAuthenticator).not.toHaveBeenCalled();
    expect(setToken).not.toHaveBeenCalled();
  });

  it('does nothing when callback marker is absent', async () => {
    await completeOidcCallbackInBrowser(
      {
        auth: { setAuthenticator, setToken },
        request,
        resource: () => ({ exchange }),
      },
      {
        location: {
          pathname: '/admin',
          search: '?tab=users',
          hash: '',
        },
        history: { replaceState, state: null },
        sessionStorage: {
          getItem,
          removeItem,
          setItem: vi.fn(),
          clear: vi.fn(),
          key: vi.fn(),
          length: 0,
        },
      },
      'title',
      navigate,
    );

    expect(exchange).not.toHaveBeenCalled();
    expect(setAuthenticator).not.toHaveBeenCalled();
    expect(setToken).not.toHaveBeenCalled();
    expect(replaceState).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });
});
