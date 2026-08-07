import type { Context, Next } from '@nocobase/actions';
import type { Application } from '@nocobase/server';
import * as oidc from 'openid-client';
import {
  AUTH_TYPE,
  CALLBACK_TICKET_COOKIE_NAME,
  DEFAULT_AUTHENTICATOR,
  EXCHANGE_ACTION,
  FLOW_COOKIE_NAME,
} from '../shared/constants';
import { buildAuthorizationRequest, handleAuthorizationCallback } from './oidc';
import { normalizeOptions } from './options';
import { buildFrontendCallbackUrl, sanitizeCallbackPath, sanitizeRedirectTo } from './redirect';
import { consumeCallbackTicket, consumeOIDCState, saveCallbackTicket, saveOIDCState, sha256Base64Url } from './state-store';

interface AuthenticatorRecord {
  name: string;
  authType: string;
  enabled?: boolean;
  options?: unknown;
}

const FLOW_COOKIE_MAX_AGE_MS = 10 * 60 * 1000;
const CALLBACK_TICKET_COOKIE_MAX_AGE_MS = 120 * 1000;

function setNoStoreHeaders(ctx: Context): void {
  ctx.set('Cache-Control', 'no-store');
  ctx.set('Pragma', 'no-cache');
}

function flowCookieOptions(ctx: Context) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: ctx.secure,
    path: '/',
    maxAge: FLOW_COOKIE_MAX_AGE_MS,
    overwrite: true,
  };
}

function callbackTicketCookieOptions(ctx: Context) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: ctx.secure,
    path: '/',
    maxAge: CALLBACK_TICKET_COOKIE_MAX_AGE_MS,
    overwrite: true,
  };
}

function randomSecret(): string {
  return oidc.randomPKCECodeVerifier();
}

function getOrCreateFlowCookie(ctx: Context): string {
  const existing = ctx.cookies.get(FLOW_COOKIE_NAME);
  if (typeof existing === 'string' && existing.length > 0) {
    ctx.cookies.set(FLOW_COOKIE_NAME, existing, flowCookieOptions(ctx));
    return existing;
  }
  const created = randomSecret();
  ctx.cookies.set(FLOW_COOKIE_NAME, created, flowCookieOptions(ctx));
  return created;
}

function clearCallbackTicketCookie(ctx: Context): void {
  ctx.cookies.set(CALLBACK_TICKET_COOKIE_NAME, '', { ...callbackTicketCookieOptions(ctx), maxAge: 0 });
}

function actionValues(ctx: Context): Record<string, unknown> {
  const values = ctx.action?.params?.values;
  return typeof values === 'object' && values !== null && !Array.isArray(values) ? values : {};
}

function queryValue(ctx: Context, name: string): string | undefined {
  const value = ctx.query[name];
  if (Array.isArray(value)) return typeof value[0] === 'string' ? value[0] : undefined;
  return typeof value === 'string' ? value : undefined;
}

function callbackUrlFrom(ctx: Context, redirectUri: string): URL {
  const url = new URL(redirectUri);
  url.search = ctx.querystring;
  return url;
}

export async function getAuthenticator(ctx: Context, name: string): Promise<AuthenticatorRecord> {
  const authenticator = await ctx.db.getRepository('authenticators').findOne({ filter: { name, enabled: true } });
  if (!authenticator) ctx.throw(404, 'Authenticator is not found');
  const record = authenticator.toJSON() as AuthenticatorRecord;
  if (record.authType !== AUTH_TYPE) ctx.throw(400, 'Authenticator type is invalid');
  return record;
}

export function registerActions(app: Application, resourceName: string) {
  app.resourceManager.define({
    name: resourceName,
    actions: {
      async getAuthUrl(ctx: Context, next: Next) {
        setNoStoreHeaders(ctx);
        const values = actionValues(ctx);
        const authenticatorName = typeof values.authenticator === 'string' && values.authenticator.length > 0 ? values.authenticator : DEFAULT_AUTHENTICATOR;
        const binding = typeof values.binding === 'string' && values.binding.length > 0 ? values.binding : undefined;
        if (!binding) ctx.throw(400, 'OIDC binding is missing');
        const authenticator = await getAuthenticator(ctx, authenticatorName);
        const options = normalizeOptions(authenticator.options);
        const redirectTo = sanitizeRedirectTo(values.redirectTo);
        const callbackPath = sanitizeCallbackPath(values.callbackPath);
        const flowCookie = getOrCreateFlowCookie(ctx);
        const request = await buildAuthorizationRequest(options);

        await saveOIDCState(ctx.app.cache, request.state, {
          authenticator: authenticatorName,
          callbackPath,
          codeVerifier: request.codeVerifier,
          nonce: request.nonce,
          redirectTo,
          flowCookieHash: sha256Base64Url(flowCookie),
          clientBindingHash: sha256Base64Url(binding),
          createdAt: Date.now(),
        });

        ctx.body = { url: request.url.toString() };
        await next();
      },
      async redirect(ctx: Context, next: Next) {
        setNoStoreHeaders(ctx);
        const state = queryValue(ctx, 'state');
        if (!state) ctx.throw(400, 'OIDC state is missing');

        const stored = await consumeOIDCState(ctx.app, state);
        const flowCookie = ctx.cookies.get(FLOW_COOKIE_NAME);
        if (!flowCookie) ctx.throw(400, 'OIDC flow cookie is missing');
        if (sha256Base64Url(flowCookie) !== stored.flowCookieHash) ctx.throw(400, 'OIDC flow cookie is invalid');
        const authenticator = await getAuthenticator(ctx, stored.authenticator);
        const options = normalizeOptions(authenticator.options);
        const callbackUrl = callbackUrlFrom(ctx, options.redirectUri);
        const result = await handleAuthorizationCallback(options, callbackUrl, {
          state,
          nonce: stored.nonce,
          codeVerifier: stored.codeVerifier,
        });

        const callbackTicket = randomSecret();
        await saveCallbackTicket(ctx.app.cache, callbackTicket, {
          authenticator: stored.authenticator,
          claims: result.claims,
          redirectTo: sanitizeRedirectTo(stored.redirectTo),
          flowCookieHash: stored.flowCookieHash,
          clientBindingHash: stored.clientBindingHash,
          createdAt: Date.now(),
        });

        ctx.cookies.set(CALLBACK_TICKET_COOKIE_NAME, callbackTicket, callbackTicketCookieOptions(ctx));
        ctx.redirect(buildFrontendCallbackUrl(sanitizeCallbackPath(stored.callbackPath)));
        await next();
      },
      async [EXCHANGE_ACTION](ctx: Context, next: Next) {
        setNoStoreHeaders(ctx);
        const values = actionValues(ctx);
        const binding = typeof values.binding === 'string' && values.binding.length > 0 ? values.binding : undefined;
        if (!binding) ctx.throw(400, 'OIDC binding is missing');

        const callbackTicket = ctx.cookies.get(CALLBACK_TICKET_COOKIE_NAME);
        clearCallbackTicketCookie(ctx);
        if (!callbackTicket) ctx.throw(400, 'OIDC callback ticket is missing');

        const flowCookie = ctx.cookies.get(FLOW_COOKIE_NAME);
        if (!flowCookie) ctx.throw(400, 'OIDC flow cookie is missing');

        const storedTicket = await consumeCallbackTicket(ctx.app, callbackTicket);
        if (sha256Base64Url(flowCookie) !== storedTicket.flowCookieHash) ctx.throw(400, 'OIDC flow cookie is invalid');
        if (sha256Base64Url(binding) !== storedTicket.clientBindingHash) ctx.throw(400, 'OIDC binding is invalid');

        ctx.state.externalOIDCClaims = storedTicket.claims;
        ctx.auth = await ctx.app.authManager.get(storedTicket.authenticator, ctx);
        const authResponse = await ctx.auth.signIn() as { token: string };
        ctx.body = {
          authenticator: storedTicket.authenticator,
          token: authResponse.token,
          redirectTo: storedTicket.redirectTo,
        };
        await next();
      },
    },
  });
}
