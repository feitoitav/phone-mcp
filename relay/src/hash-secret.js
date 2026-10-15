'use strict';
// Usage: node src/hash-secret.js <secret>  -> prints sha256 hex for DEVICES_JSON. Generate secrets with: openssl rand -hex 32
console.log(require('./auth').hashHex(process.argv[2] || ''));
