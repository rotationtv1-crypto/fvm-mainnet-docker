# Real-time scan data-swapping server

A lightweight Node.js + WebSocket engine that bridges the Docker/Trivy scan
pipeline to connected frontends. When a container image scan finishes, the
pipeline posts the results to a webhook and the server instantly streams the
fresh vulnerability metrics to every active client — no polling required.

## Topology

```
+-----------------------------------+             +-----------------------+
|  Private Linux/Docker Ecosystem   |             |   Public Cloud Edge   |
|                                   |             |                       |
|  [Trivy Scanner]                  |             |   [Cloudflare CDN]    |
|         │ (Scans Completed)       |   Secure    |          │            |
|         ▼                         |   Tunnel    |          ▼            |
|  [Node WebSocket Server] ═════════╬═════════════╬══> [Railway / Client] |
|   (Maintains Active Connection)   |             |  (Live Data Swap UI)  |
+-----------------------------------+             +-----------------------+
```

## Layout

| Path                   | Purpose                                                     |
| ---------------------- | ----------------------------------------------------------- |
| `server.js`            | Express + `ws` server: client pool, heartbeat, webhook fan-out |
| `package.json`         | Dependencies (`express`, `ws`) and `npm start`              |
| `Dockerfile`           | Containerizes the server on `node:18-alpine`                |
| `cloudflared/config.yml` | Cloudflare Tunnel ingress config template                 |
| `public/client.js`     | Frontend connector that reflects updates into the UI        |

## Run locally

```bash
cd realtime-server
npm install                       # installs express + ws
WEBHOOK_SECRET=dev-secret npm start   # → 📡 Communication matrix active on port 3000
```

Health check: `GET /healthz` returns `{ "status": "ok", "clients": <n> }`.

## Configuration

| Variable         | Required | Purpose                                                                 |
| ---------------- | -------- | ----------------------------------------------------------------------- |
| `PORT`           | No       | Listen port (default `3000`).                                           |
| `WEBHOOK_SECRET` | Yes      | Shared secret for the scan-complete webhook. Until set, the webhook rejects every request with `503`. |

Set `WEBHOOK_SECRET` as a Railway variable, a systemd `Environment=` line, or a
`docker run -e WEBHOOK_SECRET=…` flag. The WebSocket stream itself is read-only
for clients, so only the inbound webhook is authenticated.

## Build & run with Docker

```bash
cd realtime-server
docker build -t fvm-realtime-server .
docker run -p 3000:3000 fvm-realtime-server
```

## Push a scan update

Wire this into your Docker build pipeline as the final step after Trivy
completes. The request must carry the shared secret in either an
`X-Webhook-Secret` header or an `Authorization: Bearer <secret>` header.
Example payload:

```bash
curl -X POST http://localhost:3000/api/webhook/scan-complete \
  -H 'Content-Type: application/json' \
  -H "X-Webhook-Secret: $WEBHOOK_SECRET" \
  -d '{
    "image_version": "lotus:v1.33.0",
    "distribution": "debian 12",
    "packages": 412,
    "vulnerabilities": { "critical": 0, "high": 1, "medium": 3, "low": 7, "unknown": 0 }
  }'
```

Every connected client receives the payload immediately over its WebSocket.

## Deployment

### Route A — Cloudflare Tunnel (zero-trust edge link)

Use this when the server runs on a local Linux host or an isolated VPC and you
want to expose the live data-swap connection without opening inbound ports.

1. Install the `cloudflared` agent:
   ```bash
   curl -L --output cloudflared.deb https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
   sudo dpkg -i cloudflared.deb
   ```
2. Authenticate with your domain:
   ```bash
   cloudflared tunnel login
   ```
3. Create the tunnel:
   ```bash
   cloudflared tunnel create ecosystem-tunnel
   ```
4. Edit `cloudflared/config.yml` — replace `<TUNNEL_ID>` with the ID printed
   above and set your `hostname`. WebSocket upgrades are proxied transparently,
   so no extra settings are needed.
5. Run the tunnel:
   ```bash
   cloudflared tunnel run ecosystem-tunnel
   ```

### Route B — Railway (managed cloud hosting)

Use this to host the aggregator in a scalable managed environment instead of
internal hardware. Railway carries WebSocket connections over its HTTP proxy
out of the box.

1. Install the CLI: `npm i -g @railway/cli`
2. Link your session: `railway login`
3. From this directory (contains the `Dockerfile` and `server.js`): `railway init`
4. Deploy: `railway up`
5. In the Railway dashboard: **Settings** → **Generate Domain** to get a public
   `https://…` URL.

## Frontend integration

Point `public/client.js` at your secure Cloudflare hostname or Railway domain
(`wss://connect.yourdomain.com`) and include it in your dashboard. It parses
each incoming payload and updates the image version, distribution, package
count, and vulnerability counters in place.
