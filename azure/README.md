# Feito relay (Azure)

Owner: Captain Obvious Engineering.

The Android app no longer uses `https://phonemcp.ai`. Default host is `https://relay.feitoitav.com`. A device can override that URL in DataStore (`relay_url`). The wire protocol in `PROTOCOL.md` stays the same so the existing `TunnelClient` does not change.

## What to build

A relay that the phone dials outbound. No inbound ports on the phone.

| Piece | Azure suggestion | Must speak |
| --- | --- | --- |
| Device API | Container App or Function | `POST /api/devices/register`, pairing-code, clients, entitlement |
| Tunnel | Web PubSub or Container App WebSocket | `/tunnel` frames: `hello`, `hello_ok`, `req`, `head`, `chunk`, `end`, `cancel` |
| Public MCP | Front Door or the container HTTPS | `https://relay.feitoitav.com/sse` |
| Secrets | Key Vault | `deviceSecret`, client tokens. Never log them. |

Rules from `PROTOCOL.md` that must not be dropped:

- Phone authenticates the tunnel with `deviceId` + `deviceSecret`.
- MCP clients pair with a single-use code. Tokens are bound to one device.
- The relay rewrites `Authorization` before the request hits `127.0.0.1` on the phone. The relay must not learn the phone's local bearer token.
- Skip the phonemcp.ai paid entitlement. Feito devices are always `paid` or an internal `active` status.

## Not in this repo yet

No Azure subscription is connected to Grok. Captain Obvious needs a subscription id, resource group, and the real hostname before deploying. Do not invent credentials.

## Later workload

Ask every bot which one set up CIPP and which one set up EasyDMARC. Record the answer. Future development and tenant setup for both moves to Captain Obvious. Do not take that work until the current owner is identified.

## Skeleton status (Engineering)

Hosting target: **Azure Container App** (`azure/infra/main.bicep`). It is parameterized and has not been deployed.

| Path | What |
| --- | --- |
| `relay/` | Node 20 relay. `/tunnel` (WS, PROTOCOL.md frames), `/sse` + `/messages*` (phone), `/pc/{id}/mcp` (PC), `/healthz`. `/api/devices/*` returns 501 for now. |
| `pc-agent/` | Windows agent. Dials `wss://<host>/tunnel`, forwards to Windows-MCP on `http://127.0.0.1:8000/mcp`. |
| `azure/infra/` | Container Apps Bicep + example parameters (placeholders only). |

Routes:

- Phone: `https://<host>/sse`. The device comes from the bearer token, which is bound to one phone.
- PC: `https://<host>/pc/{id}/mcp`. The bearer token must be bound to `{id}`, otherwise the relay returns 401.

Auth: every device has its own tunnel `secret` and its own client token(s). The relay stores only SHA-256 hashes in `DEVICES_JSON` (from Key Vault) and compares them with `crypto.timingSafeEqual`. Another device's token, or a phone token on a PC route, gets a 401. To hash a value, run `node relay/src/hash-secret.js <value>`.

```json
{ "pc-frontdesk": { "kind": "pc", "secretSha256": "<hex>", "clientTokenSha256": ["<hex>"] } }
```

Tests: `cd relay && npm install && npm test`.

### Windows PC setup

1. Windows-MCP, local only:
   `uvx windows-mcp --transport streamable-http --host 127.0.0.1 --port 8000 --auth-key <LOCAL_KEY> --exclude-tools "PowerShell,Registry"`
   (check the flag names against the installed Windows-MCP version).
2. Agent: set `RELAY_URL=https://<host>`, `DEVICE_ID`, `DEVICE_SECRET`, `WINDOWS_MCP_AUTH_KEY=<LOCAL_KEY>`, then run `node pc-agent/agent.js` as a service (NSSM or a Scheduled Task). The agent swaps in the local key for `Authorization`, so the relay never sees that key. It forwards only `/mcp`, and only to loopback.

### Known gaps

- The OAuth 2.1 / pairing-code flow and `/api/devices/*` are still TODO. Client tokens come from `DEVICES_JSON` for now.
- One replica only, because tunnels are held in memory.
- `https://relay.feitoitav.com` is a **placeholder** until Frank confirms the hostname.

### Inputs needed before any Azure resource is created

Subscription id; resource group; region; final hostname and who controls feitoitav.com DNS; certificate approach (managed or our own); container registry; Key Vault (existing or new, and who writes secrets); initial device list (ids, phone or PC); deploying identity (Grok has no Azure access); log retention and budget.
