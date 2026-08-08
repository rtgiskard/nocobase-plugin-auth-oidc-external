import { copyFileSync, writeFileSync } from 'node:fs';

copyFileSync('dist/server/index.d.ts', 'server.d.ts');
writeFileSync('server.js', "module.exports = require('./dist/server/index.js');\n");
writeFileSync('client.js', "module.exports = require('./dist/client/index.js');\n");
writeFileSync('client-v2.js', "module.exports = require('./dist/client-v2/index.js');\n");
writeFileSync('client-v2.d.ts', "export * from './dist/client-v2';\nexport { default } from './dist/client-v2';\n");
