import type { Cache } from '@nocobase/cache';
import type { Application } from '@nocobase/server';
import { describe, expect, it } from 'vitest';
import { consumeCallbackTicket, consumeOIDCState, saveCallbackTicket, saveOIDCState } from './state-store';

class MemoryCache {
  private values = new Map<string, unknown>();

  async set(key: string, value: unknown) {
    this.values.set(key, value);
  }

  async get<T>(key: string): Promise<T | undefined> {
    return this.values.get(key) as T | undefined;
  }

  async del(key: string) {
    this.values.delete(key);
  }
}

class SerialLockManager {
  private locks = new Map<string, Promise<void>>();

  async runExclusive<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(key) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.locks.set(key, previous.then(() => current));
    await previous;
    try {
      return await fn();
    } finally {
      release();
      if (this.locks.get(key) === current) this.locks.delete(key);
    }
  }
}

function app() {
  return {
    cache: new MemoryCache(),
    lockManager: new SerialLockManager(),
  } as unknown as Application;
}

describe('OIDC state store', () => {
  it('consumes saved state once', async () => {
    const testApp = app();
    await saveOIDCState(testApp.cache as Cache, 'state-value', {
      authenticator: 'oidc',
      callbackPath: '/v/oidc-external/callback',
      codeVerifier: 'code-verifier',
      nonce: 'nonce',
      redirectTo: '/admin',
      flowCookieHash: 'hash-flow',
      clientBindingHash: 'hash-binding',
      createdAt: Date.now(),
    });

    await expect(consumeOIDCState(testApp, 'state-value')).resolves.toMatchObject({
      authenticator: 'oidc',
      callbackPath: '/v/oidc-external/callback',
      nonce: 'nonce',
    });
    await expect(consumeOIDCState(testApp, 'state-value')).rejects.toThrow('OIDC state is invalid or expired');
  });

  it('serializes concurrent consumption of the same state', async () => {
    const testApp = app();
    await saveOIDCState(testApp.cache as Cache, 'state-value', {
      authenticator: 'oidc',
      callbackPath: '/v/oidc-external/callback',
      codeVerifier: 'code-verifier',
      nonce: 'nonce',
      redirectTo: '/admin',
      flowCookieHash: 'hash-flow',
      clientBindingHash: 'hash-binding',
      createdAt: Date.now(),
    });

    const results = await Promise.allSettled([
      consumeOIDCState(testApp, 'state-value'),
      consumeOIDCState(testApp, 'state-value'),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
  });
});

describe('OIDC callback ticket store', () => {
  it('consumes saved callback ticket once', async () => {
    const testApp = app();
    await saveCallbackTicket(testApp.cache as Cache, 'ticket-value', {
      authenticator: 'oidc',
      claims: { iss: 'https://issuer.test', sub: 'user-1' },
      redirectTo: '/v/admin',
      flowCookieHash: 'hash-flow',
      clientBindingHash: 'hash-binding',
      createdAt: Date.now(),
    });

    await expect(consumeCallbackTicket(testApp, 'ticket-value')).resolves.toMatchObject({
      authenticator: 'oidc',
      redirectTo: '/v/admin',
      flowCookieHash: 'hash-flow',
      clientBindingHash: 'hash-binding',
    });
    await expect(consumeCallbackTicket(testApp, 'ticket-value')).rejects.toThrow('OIDC callback ticket is invalid or expired');
  });

  it('rejects wrong callback ticket', async () => {
    const testApp = app();
    await saveCallbackTicket(testApp.cache as Cache, 'ticket-value', {
      authenticator: 'oidc',
      claims: { iss: 'https://issuer.test', sub: 'user-1' },
      redirectTo: '/v/admin',
      flowCookieHash: 'hash-flow',
      clientBindingHash: 'hash-binding',
      createdAt: Date.now(),
    });
    await expect(consumeCallbackTicket(testApp, 'ticket-other')).rejects.toThrow('OIDC callback ticket is invalid or expired');
  });
});
