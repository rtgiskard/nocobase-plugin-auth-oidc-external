import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const externalPackages = [
  ['@nocobase/auth', '@nocobase/auth'],
  ['@nocobase/client', '@nocobase/client'],
  ['@nocobase/client-v2', '@nocobase/client-v2'],
  ['@nocobase/plugin-auth/client-v2', '@nocobase/plugin-auth'],
  ['@nocobase/server', '@nocobase/server'],
  ['antd', 'antd'],
  ['react', 'react'],
  ['react/jsx-runtime', 'react'],
  ['react-router-dom', 'react-router-dom'],
];

const versions = Object.fromEntries(
  externalPackages.map(([moduleId, packageName]) => [moduleId, require(`${packageName}/package.json`).version]),
);

writeFileSync('dist/externalVersion.js', `module.exports = ${JSON.stringify(versions, null, 2)};\n`);
