'use strict';
// Feito MCP relay skeleton. Product: Engineering.
// MCP client --https--> relay --wss /tunnel--> phone (PhoneMCP) | pc-agent --> Windows-MCP 127.0.0.1:8000
const http = require('http');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const { DeviceRegistry } = require('./auth');

const HOP = new Set(['host', 'connection', 'authorization', 'content-length', 'transfer-encoding', 'upgrade', 'keep-alive']);

function bearer(req) {
  const m = /^Bearer\s+(.+)$/i.exec(req.headers.authorization || '');
  return m ? m[1].trim() : null;
}

function createRelay({ registry = DeviceRegistry.fromEnv(), helloTimeoutMs = 10000 } = {}) {
  const tunnels = new Map(); // deviceId -> { ws, pending: Map<id, res> }

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://relay');
    if (url.pathname === '/healthz') { res.writeHead(200).end('ok'); return; }
    if (url.pathname.startsWith('/api/devices')) {
      // TODO(Engineering): register / pairing-code / clients / entitlement per PROTOCOL.md.
      // Entitlement for Feito devices is always {"status":"paid"}.
      res.writeHead(501, { 'content-type': 'application/json' }).end('{"error":"not_implemented"}');
      return;
    }
    let deviceId, path, kind;
    const pc = /^\/pc\/([A-Za-z0-9_-]{1,64})(\/mcp(?:\/.*)?)$/.exec(url.pathname);
    const token = bearer(req);
    if (pc) {
      kind = 'pc'; deviceId = pc[1]; path = pc[2] + url.search;
      if (!registry.verifyClientToken(deviceId, token, 'pc')) return deny(res);
    } else if (url.pathname === '/sse' || url.pathname.startsWith('/messages')) {
      kind = 'phone'; deviceId = registry.deviceForClientToken(token, 'phone'); path = url.pathname + url.search;
      if (!deviceId) return deny(res);
    } else { res.writeHead(404).end(); return; }

    const t = tunnels.get(deviceId);
    if (!t) { res.writeHead(503, { 'content-type': 'application/json' }).end('{"error":"device_offline"}'); return; }

    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const id = 'r' + crypto.randomBytes(8).toString('hex');
      const headers = {};
      for (const [k, v] of Object.entries(req.headers)) if (!HOP.has(k)) headers[k] = v;
      const frame = { type: 'req', id, method: req.method, path, headers };
      if (chunks.length) frame.body = Buffer.concat(chunks).toString('utf8');
      t.pending.set(id, res);
      res.on('close', () => {
        if (t.pending.delete(id) && t.ws.readyState === 1) t.ws.send(JSON.stringify({ type: 'cancel', id }));
      });
      t.ws.send(JSON.stringify(frame));
    });
  });

  function deny(res) {
    res.writeHead(401, { 'content-type': 'application/json', 'www-authenticate': 'Bearer' }).end('{"error":"unauthorized"}');
  }

  const wss = new WebSocketServer({ noServer: true });
  server.on('upgrade', (req, socket, head) => {
    if (new URL(req.url, 'http://relay').pathname !== '/tunnel') { socket.destroy(); return; }
    wss.handleUpgrade(req, socket, head, (ws) => onTunnel(ws));
  });

  function onTunnel(ws) {
    let deviceId = null;
    const pending = new Map();
    const timer = setTimeout(() => ws.close(4001, 'hello timeout'), helloTimeoutMs);
    ws.on('message', (raw) => {
      let m; try { m = JSON.parse(raw.toString()); } catch { return ws.close(4002, 'bad json'); }
      if (!deviceId) {
        clearTimeout(timer);
        if (m.type !== 'hello' || !registry.verifyDeviceSecret(m.deviceId, m.secret)) {
          ws.send(JSON.stringify({ type: 'error', message: 'unauthorized' }));
          return ws.close(4003, 'unauthorized');
        }
        deviceId = m.deviceId;
        const old = tunnels.get(deviceId);
        if (old) old.ws.close(4004, 'replaced');
        tunnels.set(deviceId, { ws, pending });
        return ws.send(JSON.stringify({ type: 'hello_ok' }));
      }
      const res = pending.get(m.id);
      if (!res) return;
      if (m.type === 'head') {
        const h = {};
        for (const [k, v] of Object.entries(m.headers || {})) if (!HOP.has(k.toLowerCase())) h[k] = v;
        res.writeHead(m.status || 502, h); res.flushHeaders?.();
      } else if (m.type === 'chunk') {
        res.write(Buffer.from(m.data || '', 'base64'));
      } else if (m.type === 'end' || m.type === 'error') {
        pending.delete(m.id);
        if (!res.headersSent) res.writeHead(502);
        res.end();
      }
    });
    ws.on('close', () => {
      clearTimeout(timer);
      if (deviceId && tunnels.get(deviceId)?.ws === ws) tunnels.delete(deviceId);
      for (const res of pending.values()) { if (!res.headersSent) res.writeHead(502); res.end(); }
    });
  }

  return { server, tunnels };
}

if (require.main === module) {
  const port = Number(process.env.PORT || 8080);
  createRelay().server.listen(port, () => console.log(`relay listening on :${port}`)); // never log secrets
}

module.exports = { createRelay };
