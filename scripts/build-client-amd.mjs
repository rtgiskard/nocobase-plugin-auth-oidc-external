import { readFileSync, writeFileSync } from 'node:fs';
import esbuild from 'esbuild';

const packageName = '@nocobase/plugin-auth-oidc-external';
const clientModuleName = `${packageName}/client-v2`;

await esbuild.build({
  entryPoints: ['src/client-v2/index.tsx'],
  bundle: true,
  outfile: 'dist/client-v2/index.js',
  format: 'iife',
  globalName: '__NocoBaseExternalOIDCClient',
  platform: 'browser',
  target: ['es2020'],
  external: [
    '@nocobase/client-v2',
    '@nocobase/plugin-auth/client-v2',
    'antd',
    'react',
    'react-dom',
    'react-router-dom',
    'react/jsx-runtime',
  ],
});

const deps = [
  '@nocobase/client-v2',
  '@nocobase/plugin-auth/client-v2',
  'antd',
  'react',
  'react-router-dom',
  'react/jsx-runtime',
];
const params = ['nocobaseClientV2', 'authPluginClientV2', 'antd', 'react', 'reactRouterDom', 'jsxRuntime'];
const requireShim = [
  '  var require = function(name) {',
  '    if (name === "@nocobase/client-v2") return nocobaseClientV2;',
  '    if (name === "@nocobase/plugin-auth/client-v2") return authPluginClientV2;',
  '    if (name === "antd") return antd;',
  '    if (name === "react") return react;',
  '    if (name === "react-router-dom") return reactRouterDom;',
  '    if (name === "react/jsx-runtime") return jsxRuntime;',
  '    throw new Error("Cannot require " + name);',
  '  };',
].join('\n');
const bundle = readFileSync('dist/client-v2/index.js', 'utf8');
writeFileSync(
  'dist/client-v2/index.js',
  `define("${clientModuleName}", ${JSON.stringify(deps)}, function(${params.join(', ')}) {\n${requireShim}\n${bundle}\n  return __NocoBaseExternalOIDCClient;\n});\n`,
);
