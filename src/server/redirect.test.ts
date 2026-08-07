import { describe, expect, it } from 'vitest';
import { CALLBACK_MARKER_PARAM, CALLBACK_MARKER_VALUE } from '../shared/constants';
import { buildFrontendCallbackUrl, sanitizeCallbackPath, sanitizeRedirectTo } from './redirect';

describe('sanitizeRedirectTo', () => {
  it('keeps local relative paths', () => {
    expect(sanitizeRedirectTo('/v/admin')).toBe('/v/admin');
    expect(sanitizeRedirectTo('/v/admin?tab=users#top')).toBe('/v/admin?tab=users#top');
  });

  it('rejects external and protocol-relative redirects', () => {
    expect(sanitizeRedirectTo('https://evil.test/callback')).toBe('/v/admin');
    expect(sanitizeRedirectTo('//evil.test/callback')).toBe('/v/admin');
    expect(sanitizeRedirectTo('javascript:alert(1)')).toBe('/v/admin');
  });

  it('rejects backslash redirects', () => {
    expect(sanitizeRedirectTo('/\\evil.test')).toBe('/v/admin');
  });

  it('removes callback and secret-bearing query parameters', () => {
    expect(sanitizeRedirectTo('/v/admin?keep=1&token=x&authenticator=y&code=c&state=s&ticket=t&oidc_external=callback')).toBe(
      '/v/admin?keep=1',
    );
  });
});

describe('buildFrontendCallbackUrl', () => {
  it('returns a prefixed public v2 callback with only the marker', () => {
    expect(buildFrontendCallbackUrl('/nocobase/v/oidc-external/callback')).toBe(
      `/nocobase/v/oidc-external/callback?${CALLBACK_MARKER_PARAM}=${CALLBACK_MARKER_VALUE}`,
    );
  });
});

describe('sanitizeCallbackPath', () => {
  it('keeps standard and prefixed client-v2 callback paths', () => {
    expect(sanitizeCallbackPath('/v/oidc-external/callback')).toBe('/v/oidc-external/callback');
    expect(sanitizeCallbackPath('/nocobase/v/oidc-external/callback')).toBe('/nocobase/v/oidc-external/callback');
  });

  it('falls back to the standard callback for empty input', () => {
    expect(sanitizeCallbackPath('')).toBe('/v/oidc-external/callback');
    expect(sanitizeCallbackPath(undefined)).toBe('/v/oidc-external/callback');
  });

  it.each([
    'https://evil.test/v/oidc-external/callback',
    '//evil.test/v/oidc-external/callback',
    '/\\evil.test/v/oidc-external/callback',
    '/nocobase/v/oidc-external/callback?ticket=secret',
    '/nocobase/v/oidc-external/callback#fragment',
    '/nocobase/v/oidc-external/%63allback',
    '/nocobase/v/../v/oidc-external/callback',
    '/nocobase/oidc-external/callback',
  ])('falls back for unsafe callback path %s', (callbackPath) => {
    expect(sanitizeCallbackPath(callbackPath)).toBe('/v/oidc-external/callback');
  });
});
