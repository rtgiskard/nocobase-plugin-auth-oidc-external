const DEFAULT_POST_SIGN_IN_REDIRECT = '/admin';
const FRONTEND_CALLBACK_SUFFIX = '/oidc-external/callback';

function normalizeBasename(basename: string): string {
  return basename === '/' ? '' : basename.replace(/\/+$/, '');
}

export function frontendCallbackPathFrom(basename: string): string {
  return `${normalizeBasename(basename)}${FRONTEND_CALLBACK_SUFFIX}`;
}

export function postSignInRedirectFrom(
  location: Pick<Location, 'pathname' | 'search' | 'hash'>,
  basename: string,
): string {
  if (location.pathname === `${normalizeBasename(basename)}/signin`) {
    const redirect = new URLSearchParams(location.search).get('redirect');
    return redirect && redirect.length > 0 ? redirect : DEFAULT_POST_SIGN_IN_REDIRECT;
  }

  return `${location.pathname}${location.search}${location.hash}`;
}
