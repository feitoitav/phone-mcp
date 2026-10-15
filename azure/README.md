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
