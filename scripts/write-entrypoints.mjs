import { copyFileSync, writeFileSync } from 'node:fs';

copyFileSync('dist/server/index.js', 'server.js');
copyFileSync('dist/server/index.d.ts', 'server.d.ts');
writeFileSync('client-v2.js', "module.exports = require('./dist/client-v2/index.js');\n");
writeFileSync('client-v2.d.ts', "export * from './dist/client-v2';\nexport { default } from './dist/client-v2';\n");
