// server.js
// Real-time data-swapping server: bridges the Docker/Trivy scan pipeline to
// connected frontends over WebSockets. A scan-complete webhook pushes fresh
// vulnerability metrics to every active client instantly.
const express = require('express');
const http = require('http');
const crypto = require('crypto');
const WebSocket = require('ws');

const app = express();
app.use(express.json());

// Shared secret used to authenticate the scan-complete webhook. Set it in the
// environment (e.g. Railway variables or the systemd unit running cloudflared).
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || '';
if (!WEBHOOK_SECRET) {
  console.warn(
    '⚠️  WEBHOOK_SECRET is not set — /api/webhook/scan-complete will reject all requests until it is configured.'
  );
}

// Timing-safe comparison so a token check does not leak length/content via
// response timing. Returns false for any mismatch or missing value.
function isValidSecret(provided) {
  if (!WEBHOOK_SECRET || !provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(WEBHOOK_SECRET);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// Extract the presented secret from either `X-Webhook-Secret` or a
// `Authorization: Bearer <token>` header.
function extractSecret(req) {
  const header = req.get('x-webhook-secret');
  if (header) return header;
  const auth = req.get('authorization') || '';
  const match = auth.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : '';
}

function authenticateWebhook(req, res, next) {
  if (!WEBHOOK_SECRET) {
    return res.status(503).json({ error: 'Webhook authentication is not configured' });
  }
  if (!isValidSecret(extractSecret(req))) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  return next();
}

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Track actively connected clients/frontends
const connectedClients = new Set();

// Heartbeat: terminate connections that stop responding to pings so the
// client pool does not accumulate dead sockets.
const HEARTBEAT_INTERVAL_MS = 30000;

wss.on('connection', (ws) => {
  console.log('✨ Active data-swapping channel established with client.');
  connectedClients.add(ws);

  ws.isAlive = true;
  ws.on('pong', () => {
    ws.isAlive = true;
  });

  // Handle incoming heartbeats or data messages from client
  ws.on('message', (message) => {
    console.log(`📥 Received from client: ${message}`);
  });

  ws.on('close', () => {
    console.log('❌ Client disconnected from stream.');
    connectedClients.delete(ws);
  });

  ws.on('error', (err) => {
    console.error('⚠️  WebSocket error:', err.message);
    connectedClients.delete(ws);
  });
});

const heartbeat = setInterval(() => {
  for (const ws of connectedClients) {
    if (ws.isAlive === false) {
      connectedClients.delete(ws);
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    ws.ping();
  }
}, HEARTBEAT_INTERVAL_MS);

wss.on('close', () => clearInterval(heartbeat));

// Simple health check for Railway / Cloudflare / container orchestrators
app.get('/healthz', (_req, res) => {
  res.status(200).json({ status: 'ok', clients: connectedClients.size });
});

// Endpoint triggered by your Docker build pipeline when a scan finishes.
// Requires a valid shared secret (see authenticateWebhook).
app.post('/api/webhook/scan-complete', authenticateWebhook, (req, res) => {
  const scanData = req.body;
  console.log(`🚀 Broadcasting new scan data for: ${scanData.image_version}`);

  // Instantly swap/push data down to every active user interface
  const payload = JSON.stringify(scanData);
  for (const client of connectedClients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  }
  return res.status(200).json({ status: 'Broadcast successful' });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`📡 Communication matrix active on port ${PORT}`));

// Graceful shutdown so in-flight connections close cleanly on redeploy
function shutdown() {
  console.log('🛑 Shutting down communication matrix...');
  clearInterval(heartbeat);
  for (const client of connectedClients) {
    client.close(1001, 'Server shutting down');
  }
  server.close(() => process.exit(0));
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
