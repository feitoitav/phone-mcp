'use strict';
const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const { WebSocket } = require('ws');
const { createRelay } = require('../src/server');
const { DeviceRegistry, hashHex } = require('../src/auth');
const { startAgent } = require('../../pc-agent/agent');

const reg = new DeviceRegistry({
  phone1: { kind: 'phone', secretSha256: hashHex('phone1-secret'), clientTokenSha256: [hashHex('phone1-token')] },
  pc1: { kind: 'pc', secretSha256: hashHex('pc1-secret'), clientTokenSha256: [hashHex('pc1-token')] },
  pc2: { kind: 'pc', secretSha256: hashHex('pc2-secret'), clientTokenSha256: [hashHex('pc2-token')] },
});

test('registry: secret/token bound to device id', () => {
  assert.ok(reg.verifyDeviceSecret('pc1', 'pc1-secret'));
  assert.ok(!reg.verifyDeviceSecret('pc1', 'pc2-secret'));
  assert.ok(!reg.verifyDeviceSecret('nope', 'pc1-secret'));
  assert.ok(reg.verifyClientToken('pc1', 'pc1-token', 'pc'));
  assert.ok(!reg.verifyClientToken('pc2', 'pc1-token', 'pc'));
  assert.ok(!reg.verifyClientToken('phone1', 'phone1-token', 'pc'));
  assert.equal(reg.deviceForClientToken('phone1-token', 'phone'), 'phone1');
  assert.equal(reg.deviceForClientToken('pc1-token', 'phone'), null);
  assert.ok(!JSON.stringify(reg.devices).includes('pc1-secret'));
});

function listen(srv) { return new Promise((r) => srv.listen(0, '127.0.0.1', () => r(srv.address().port))); }
const hello = (port, deviceId, secret) => new Promise((resolve) => {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/tunnel`);
  ws.on('open', () => ws.send(JSON.stringify({ type: 'hello', deviceId, secret })));
  ws.on('message', (d) => resolve({ ws, msg: JSON.parse(d) }));
});

test('tunnel rejects wrong secret, accepts right one', async () => {
  const { server } = createRelay({ registry: reg });
  const port = await listen(server);
  const bad = await hello(port, 'pc1', 'pc2-secret');
  assert.equal(bad.msg.type, 'error'); bad.ws.close();
  const good = await hello(port, 'pc1', 'pc1-secret');
  assert.equal(good.msg.type, 'hello_ok'); good.ws.close();
  server.close();
});

test('end to end: /pc/{id}/mcp via pc-agent to local Windows-MCP; cross-device token rejected', async () => {
  let seenAuth;
  const fake = http.createServer((req, res) => {
    seenAuth = req.headers.authorization;
    let b = ''; req.on('data', (c) => (b += c));
    req.on('end', () => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ path: req.url, echo: b })); });
  });
  const localPort = await listen(fake);
  const { server, tunnels } = createRelay({ registry: reg });
  const port = await listen(server);
  const agent = startAgent({ relayUrl: `http://127.0.0.1:${port}`, deviceId: 'pc1', secret: 'pc1-secret',
    localBase: `http://127.0.0.1:${localPort}`, localAuthKey: 'local-key' });
  while (!tunnels.has('pc1')) await new Promise((r) => setTimeout(r, 20));

  const call = (path, token) => fetch(`http://127.0.0.1:${port}${path}`, { method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: '{"jsonrpc":"2.0"}' });

  const ok = await call('/pc/pc1/mcp', 'pc1-token');
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), { path: '/mcp', echo: '{"jsonrpc":"2.0"}' });
  assert.equal(seenAuth, 'Bearer local-key');
  assert.equal((await call('/pc/pc1/mcp', 'pc2-token')).status, 401);
  assert.equal((await call('/pc/pc1/mcp', 'phone1-token')).status, 401);
  assert.equal((await call('/pc/pc2/mcp', 'pc2-token')).status, 503); // offline
  assert.equal((await call('/sse', 'pc1-token')).status, 401);
  agent.stop(); server.close(); fake.close();
});
