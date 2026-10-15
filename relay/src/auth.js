'use strict';
// Per-device credentials. Only SHA-256 hashes are stored; comparisons are constant-time.
const crypto = require('crypto');

const sha256 = (s) => crypto.createHash('sha256').update(String(s), 'utf8').digest();
const hashHex = (s) => sha256(s).toString('hex');

function safeEqualHex(aHex, bHex) {
  const a = Buffer.from(String(aHex), 'hex');
  const b = Buffer.from(String(bHex), 'hex');
  if (a.length !== 32 || b.length !== 32) return false;
  return crypto.timingSafeEqual(a, b);
}

/**
 * Registry shape (JSON, loaded from DEVICES_JSON env / Key Vault reference):
 * { "<deviceId>": { "kind": "phone"|"pc", "secretSha256": "<hex>", "clientTokenSha256": ["<hex>", ...] } }
 * secret       = tunnel credential the device presents in `hello`.
 * client token = bearer an MCP client (Grok) presents on the public route; bound to exactly one device.
 */
class DeviceRegistry {
  constructor(devices = {}) { this.devices = devices; }
  static fromEnv(env = process.env) {
    return new DeviceRegistry(env.DEVICES_JSON ? JSON.parse(env.DEVICES_JSON) : {});
  }
  get(id) { return Object.prototype.hasOwnProperty.call(this.devices, id) ? this.devices[id] : null; }

  /** Tunnel auth: device secret must match THIS device id. */
  verifyDeviceSecret(deviceId, secret, kind) {
    const d = this.get(deviceId);
    const presented = hashHex(secret ?? '');
    if (!d) { safeEqualHex(presented, presented); return false; } // keep timing similar
    if (kind && d.kind !== kind) return false;
    return safeEqualHex(presented, d.secretSha256);
  }

  /** Public-route auth: bearer token must be bound to THIS device id. */
  verifyClientToken(deviceId, token, kind) {
    const d = this.get(deviceId);
    if (!d || !token) return false;
    if (kind && d.kind !== kind) return false;
    const presented = hashHex(token);
    let ok = false;
    for (const h of d.clientTokenSha256 || []) ok = safeEqualHex(presented, h) || ok; // no early exit
    return ok;
  }

  /** Phone `/sse` has no id in the URL: resolve device from the token (OAuth-issued, device-bound). */
  deviceForClientToken(token, kind) {
    if (!token) return null;
    let found = null;
    for (const id of Object.keys(this.devices)) {
      if (this.verifyClientToken(id, token, kind) && !found) found = id;
    }
    return found;
  }
}

module.exports = { DeviceRegistry, hashHex, safeEqualHex };
