'use strict';
// Feito PC agent (Engineering). Dials OUT to the relay /tunnel and forwards req frames to the
// local Windows-MCP server. No inbound port is opened on the PC.
const { WebSocket } = require('ws');

const CFG = {
  relayUrl: process.env.RELAY_URL || 'https://relay.feitoitav.com', // PLACEHOLDER host
  deviceId: process.env.DEVICE_ID,
  secret: process.env.DEVICE_SECRET,
  localBase: process.env.LOCAL_MCP_BASE || 'http://127.0.0.1:8000',
  localAuthKey: process.env.WINDOWS_MCP_AUTH_KEY, // same value passed to windows-mcp --auth-key
};

function startAgent(cfg = CFG) {
  if (!cfg.deviceId || !cfg.secret) throw new Error('DEVICE_ID and DEVICE_SECRET are required');
  const local = new URL(cfg.localBase);
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(local.hostname)) throw new Error('LOCAL_MCP_BASE must be loopback');
  const wsUrl = cfg.relayUrl.replace(/^http/, 'ws').replace(/\/$/, '') + '/tunnel';
  let ws, stopped = false, backoff = 1000;
  const inflight = new Map();

  function connect() {
    ws = new WebSocket(wsUrl);
    ws.on('open', () => ws.send(JSON.stringify({ type: 'hello', deviceId: cfg.deviceId, secret: cfg.secret })));
    ws.on('message', async (raw) => {
      const m = JSON.parse(raw.toString());
      if (m.type === 'hello_ok') { backoff = 1000; return; }
      if (m.type === 'cancel') { inflight.get(m.id)?.abort(); return; }
      if (m.type === 'req') handle(m);
    });
    ws.on('close', () => { if (!stopped) setTimeout(connect, backoff = Math.min(backoff * 2, 60000)); });
    ws.on('error', () => {});
  }

  async function handle(m) {
    const send = (o) => ws.readyState === 1 && ws.send(JSON.stringify(o));
    // Only /mcp paths are forwarded; the relay prefix /pc/{id} is already stripped.
    if (!/^\/mcp(\/|\?|$)/.test(m.path)) { send({ type: 'head', id: m.id, status: 404, headers: {} }); return send({ type: 'end', id: m.id }); }
    const ac = new AbortController(); inflight.set(m.id, ac);
    try {
      const headers = { ...m.headers }; delete headers.authorization; delete headers.host;
      if (cfg.localAuthKey) headers.authorization = `Bearer ${cfg.localAuthKey}`; // relay never sees this key
      const r = await fetch(new URL(m.path, cfg.localBase), { method: m.method, headers, body: m.body, signal: ac.signal });
      send({ type: 'head', id: m.id, status: r.status, headers: Object.fromEntries(r.headers) });
      if (r.body) for await (const c of r.body) send({ type: 'chunk', id: m.id, data: Buffer.from(c).toString('base64') });
      send({ type: 'end', id: m.id });
    } catch (e) {
      send({ type: 'error', id: m.id, message: ac.signal.aborted ? 'cancelled' : 'local_mcp_unreachable' });
    } finally { inflight.delete(m.id); }
  }

  connect();
  return { stop() { stopped = true; ws?.close(); } };
}

if (require.main === module) startAgent();
module.exports = { startAgent };
