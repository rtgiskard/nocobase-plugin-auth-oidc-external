import { AUTH_RESOURCE, CALLBACK_MARKER_PARAM, CALLBACK_MARKER_VALUE, EXCHANGE_ACTION } from '../shared/constants';
import { PENDING_FLOW_STORAGE_KEY } from './storage';

interface OidcAuthTarget {
  auth: {
    setAuthenticator(authenticator: string): void;
    setRole(role: string): void;
    setToken(token: string): void;
  };
  resource(resourceName: string): {
    [action: string]: (args: { values: { binding: string } }) => Promise<unknown>;
  };
  request(options: {
    headers: { 'X-Role': false };
    url: string;
    skipAuth: boolean;
    skipNotify: boolean;
  }): Promise<unknown>;
}

interface CallbackLocation {
  hash: string;
  pathname: string;
  search: string;
}

interface BrowserLike {
  location: CallbackLocation;
  history: {
    state: unknown;
    replaceState(data: unknown, unused: string, url?: string | URL | null): void;
  };
  sessionStorage: Storage;
}

interface PendingOidcFlow {
  binding: string;
  createdAt: number;
}

interface ExchangeResponse {
  authenticator: string;
  redirectTo: string;
  token: string;
}

type Navigate = (to: string, options: { replace: true }) => void;

const PENDING_FLOW_TTL_MS = 10 * 60 * 1000;
const CALLBACK_PATH = '/oidc-external/callback';

function parsePendingFlow(value: string | null): PendingOidcFlow | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
    const binding = Reflect.get(parsed, 'binding');
    const createdAt = Reflect.get(parsed, 'createdAt');
    if (typeof binding !== 'string' || binding.length === 0) return null;
    if (typeof createdAt !== 'number' || !Number.isFinite(createdAt)) return null;
    return { binding, createdAt };
  } catch {
    return null;
  }
}

function cleanCallbackMarker(location: CallbackLocation): string {
  const searchParams = new URLSearchParams(location.search);
  searchParams.delete(CALLBACK_MARKER_PARAM);
  searchParams.delete('authenticator');
  searchParams.delete('code');
  searchParams.delete('state');
  searchParams.delete('ticket');
  searchParams.delete('token');
  const search = searchParams.toString();
  return `${location.pathname}${search ? `?${search}` : ''}${location.hash}`;
}

function isMarkedCallback(location: CallbackLocation): boolean {
  const marker = new URLSearchParams(location.search).get(CALLBACK_MARKER_PARAM);
  return marker === CALLBACK_MARKER_VALUE;
}

function exchangeDataFrom(result: unknown): ExchangeResponse | null {
  if (typeof result !== 'object' || result === null) return null;
  const data = Reflect.get(result, 'data');
  if (typeof data !== 'object' || data === null) return null;
  const payload = Reflect.get(data, 'data');
  if (typeof payload !== 'object' || payload === null) return null;
  const authenticator = Reflect.get(payload, 'authenticator');
  const redirectTo = Reflect.get(payload, 'redirectTo');
  const token = Reflect.get(payload, 'token');
  if (typeof authenticator !== 'string' || authenticator.length === 0) return null;
  if (typeof redirectTo !== 'string' || !redirectTo.startsWith('/') || redirectTo.startsWith('//')) return null;
  if (typeof token !== 'string' || token.length === 0) return null;
  return { authenticator, redirectTo, token };
}

function appRelativeRedirect(target: string, callbackPathname: string): string {
  const callbackIndex = callbackPathname.lastIndexOf(CALLBACK_PATH);
  if (callbackIndex <= 0) return target;
  const basename = callbackPathname.slice(0, callbackIndex);
  return target === basename ? '/' : target.startsWith(`${basename}/`) ? target.slice(basename.length) : target;
}

export function readPendingOidcFlow(storage: Storage): PendingOidcFlow | null {
  return parsePendingFlow(storage.getItem(PENDING_FLOW_STORAGE_KEY));
}

export function removePendingOidcFlow(storage: Storage): void {
  storage.removeItem(PENDING_FLOW_STORAGE_KEY);
}

function isPendingFlowExpired(pending: PendingOidcFlow, now: number): boolean {
  return now - pending.createdAt >= PENDING_FLOW_TTL_MS;
}

export async function completeOidcCallbackInBrowser(
  apiClient: OidcAuthTarget,
  browser: BrowserLike,
  title: string,
  navigate: Navigate,
): Promise<boolean> {
  if (!isMarkedCallback(browser.location)) return false;

  const cleanedUrl = cleanCallbackMarker(browser.location);
  browser.history.replaceState(browser.history.state, title, cleanedUrl);

  const pending = readPendingOidcFlow(browser.sessionStorage);
  if (!pending) return false;
  if (isPendingFlowExpired(pending, Date.now())) {
    removePendingOidcFlow(browser.sessionStorage);
    return false;
  }

  try {
    const result = await apiClient.resource(AUTH_RESOURCE)[EXCHANGE_ACTION]({
      values: { binding: pending.binding },
    });
    const exchange = exchangeDataFrom(result);
    if (!exchange) throw new Error('OIDC exchange payload is invalid');
    apiClient.auth.setRole('');
    apiClient.auth.setAuthenticator(exchange.authenticator);
    apiClient.auth.setToken(exchange.token);
    try {
      await apiClient.request({
        headers: { 'X-Role': false },
        url: '/auth:check',
        skipAuth: true,
        skipNotify: true,
      });
    } catch (error) {
      apiClient.auth.setToken('');
      apiClient.auth.setAuthenticator('');
      throw error;
    }
    navigate(appRelativeRedirect(exchange.redirectTo, browser.location.pathname), { replace: true });
    return true;
  } finally {
    removePendingOidcFlow(browser.sessionStorage);
  }
}
