import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { beforeAll, describe, expect, it } from 'vitest';

const packageName = '@nocobase/plugin-auth-oidc-external';

type LegacyClientModule = {
  readonly Plugin: typeof LegacyPlugin;
};

type AmdRegistration = {
  readonly dependencies: readonly string[];
  readonly factory: (client: LegacyClientModule) => unknown;
  readonly moduleId: string;
};

class LegacyPlugin {
  constructor(
    readonly options: object,
    readonly app: object,
  ) {}
}

const isModuleExports = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null;

describe('legacy client compatibility', () => {
  beforeAll(() => {
    execFileSync('npm', ['run', 'build'], { stdio: 'pipe' });
  });

  it('builds the exact bare AMD module as a no-op legacy Plugin', async () => {
    // Given
    const registrations: AmdRegistration[] = [];
    const define = (moduleId: string, dependencies: readonly string[], factory: AmdRegistration['factory']) => {
      registrations.push({ dependencies, factory, moduleId });
    };
    const bundle = readFileSync('dist/client/index.js', 'utf8');

    // When
    runInNewContext(bundle, { define });

    // Then
    expect(registrations).toHaveLength(1);
    const registration = registrations[0];
    if (!registration) throw new Error('Legacy AMD module was not registered');
    expect(registration.moduleId).toBe(packageName);
    expect(registration.dependencies).toEqual(['@nocobase/client']);

    const moduleExports = registration.factory({ Plugin: LegacyPlugin });
    expect(isModuleExports(moduleExports)).toBe(true);
    if (!isModuleExports(moduleExports)) throw new Error('Legacy AMD module did not export an object');
    const PluginClass = moduleExports.default;
    expect(typeof PluginClass).toBe('function');
    if (typeof PluginClass !== 'function') throw new Error('Legacy AMD module has no default Plugin export');

    const app = {};
    const plugin = Reflect.construct(PluginClass, [{}, app]);
    expect(plugin).toBeInstanceOf(LegacyPlugin);
    expect(await plugin.load()).toBeUndefined();
    expect(app).toEqual({});
  });

  it('builds the canonical legacy root marker', () => {
    // Given / When
    const marker = readFileSync('client.js', 'utf8');

    // Then
    expect(marker).toBe("module.exports = require('./dist/client/index.js');\n");
  });

  it('publishes the legacy marker and declares the legacy host runtime', () => {
    // Given / When
    const packageJson: unknown = JSON.parse(readFileSync('package.json', 'utf8'));

    // Then
    expect(isModuleExports(packageJson)).toBe(true);
    if (!isModuleExports(packageJson)) throw new Error('Package metadata is not an object');
    const peerDependencies = packageJson.peerDependencies;
    const devDependencies = packageJson.devDependencies;
    expect(isModuleExports(peerDependencies)).toBe(true);
    expect(isModuleExports(devDependencies)).toBe(true);
    if (!isModuleExports(peerDependencies) || !isModuleExports(devDependencies)) {
      throw new Error('Package dependency metadata is not an object');
    }
    expect(packageJson.files).toContain('client.js');
    expect(peerDependencies['@nocobase/client']).toBe('2.x');
    expect(devDependencies['@nocobase/client']).toBe('2.1.36');
  });

  it('publishes the canonical server entrypoint for NocoBase plugin discovery', () => {
    // Given / When
    const packageJson: unknown = JSON.parse(readFileSync('package.json', 'utf8'));
    const marker = readFileSync('server.js', 'utf8');

    // Then
    expect(isModuleExports(packageJson)).toBe(true);
    if (!isModuleExports(packageJson)) throw new Error('Package metadata is not an object');
    expect(packageJson.main).toBe('dist/server/index.js');
    expect(marker).toBe("module.exports = require('./dist/server/index.js');\n");
  });

  it('publishes a new patch version so NocoBase invalidates cached client bundles', () => {
    // Given / When
    const packageJson: unknown = JSON.parse(readFileSync('package.json', 'utf8'));

    // Then
    expect(isModuleExports(packageJson)).toBe(true);
    if (!isModuleExports(packageJson)) throw new Error('Package metadata is not an object');
    expect(packageJson.version).toBe('0.2.1');
  });
});
