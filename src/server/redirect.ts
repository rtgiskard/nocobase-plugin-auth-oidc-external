import { CALLBACK_MARKER_PARAM, CALLBACK_MARKER_VALUE, FRONTEND_CALLBACK_PATH } from '../shared/constants';

const DEFAULT_REDIRECT = '/v/admin';
const SENSITIVE_REDIRECT_PARAMS = new Set([
  'token',
  'authenticator',
  'ticket',
  'code',
  'state',
  CALLBACK_MARKER_PARAM,
]);

export function sanitizeRedirectTo(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) return DEFAULT_REDIRECT;
  if (!value.startsWith('/')) return DEFAULT_REDIRECT;
  if (value.startsWith('//')) return DEFAULT_REDIRECT;
  if (value.includes('\\')) return DEFAULT_REDIRECT;
  const url = new URL(value, 'https://nocobase.local');
  for (const key of SENSITIVE_REDIRECT_PARAMS) {
    url.searchParams.delete(key);
  }
  return `${url.pathname}${url.search}${url.hash}`;
}

export function sanitizeCallbackPath(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) return FRONTEND_CALLBACK_PATH;
  if (!value.startsWith('/') || value.startsWith('//')) return FRONTEND_CALLBACK_PATH;
  if (value.includes('\\') || value.includes('?') || value.includes('#') || value.includes('%')) return FRONTEND_CALLBACK_PATH;
  if (!value.endsWith(FRONTEND_CALLBACK_PATH)) return FRONTEND_CALLBACK_PATH;
  const url = new URL(value, 'https://nocobase.local');
  return url.pathname === value ? value : FRONTEND_CALLBACK_PATH;
}

export function buildFrontendCallbackUrl(callbackPath: string): string {
  return `${callbackPath}?${CALLBACK_MARKER_PARAM}=${CALLBACK_MARKER_VALUE}`;
}
