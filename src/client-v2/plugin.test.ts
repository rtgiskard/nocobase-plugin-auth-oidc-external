import { createMockClient } from '@nocobase/client-v2';
import PluginAuthClientV2 from '@nocobase/plugin-auth/client-v2';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import PluginExternalOIDCClient from './plugin';

type Route = Readonly<Record<string, unknown>>;
type MockApp = {
  readonly pm: {
    readonly get: ReturnType<typeof vi.fn>;
  };
  readonly router: {
    readonly add: (name: string, route: Route) => void;
    readonly get: (name: string) => Route | undefined;
  };
};

const mocks = vi.hoisted(() => {
  const registerType = vi.fn();
  const getPlugin = vi.fn(() => ({ registerType }));
  const routes = new Map<string, Route>();
  const app: MockApp = {
    pm: { get: getPlugin },
    router: {
      add: (name, route) => routes.set(name, route),
      get: (name) => routes.get(name),
    },
  };
  return { app, getPlugin, registerType, routes };
});

vi.mock('@nocobase/client-v2', () => ({
  Plugin: class {
    protected readonly app: MockApp;

    constructor(_options: object, app: MockApp) {
      this.app = app;
    }

    protected get pm() {
      return this.app.pm;
    }

    protected get router() {
      return this.app.router;
    }
  },
  createMockClient: () => mocks.app,
}));

vi.mock('@nocobase/plugin-auth/client-v2', () => ({
  default: class PluginAuthClientV2 {},
}));

const createPlugin = () => {
  const app = createMockClient();
  const plugin = new PluginExternalOIDCClient({}, app);
  return { app, plugin };
};

describe('PluginExternalOIDCClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.routes.clear();
  });

  it('registers lazy auth type component loaders', async () => {
    // Given
    const { plugin } = createPlugin();

    // When
    await plugin.load();

    // Then
    expect(mocks.getPlugin).toHaveBeenCalledWith(PluginAuthClientV2);
    expect(mocks.registerType).toHaveBeenCalledOnce();
    const registration: unknown = mocks.registerType.mock.calls[0]?.[1];
    expect(registration).toEqual({
      signInButtonLoader: expect.any(Function),
      adminSettingsFormLoader: expect.any(Function),
    });
  });

  it('registers a lazy callback route that skips the initial auth check', async () => {
    // Given
    const { app, plugin } = createPlugin();

    // When
    await plugin.load();

    // Then
    expect(app.router.get('oidc-external.callback')).toEqual(
      expect.objectContaining({
        path: '/oidc-external/callback',
        skipAuthCheck: true,
        componentLoader: expect.any(Function),
      }),
    );
  });
});
