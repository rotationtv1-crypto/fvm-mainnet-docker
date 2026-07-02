// client.js
// Frontend connector: subscribes to the live scan stream and reflects fresh
// vulnerability metrics into the UI as they arrive. Point the URL at your
// secure Cloudflare Tunnel hostname or your Railway-generated domain.
const socket = new WebSocket('wss://connect.yourdomain.com');

socket.onopen = () => {
  console.log('🔒 Live stream authenticated. Systems locked in.');
};

socket.onmessage = (event) => {
  const systemUpdate = JSON.parse(event.data);
  console.log('📦 Fresh security metrics incoming:', systemUpdate);

  // Target your HTML elements dynamically to reflect updates instantly
  document.querySelector('.select-dropdown option').innerText = systemUpdate.image_version;
  document.querySelector('.badge').innerText = systemUpdate.distribution;
  document.querySelector('.data-row:nth-child(3) .value').innerText = systemUpdate.packages;

  // Dynamic updates for vulnerabilities counters
  const vulnBoxes = document.querySelectorAll('.vuln-box');
  vulnBoxes[2].innerText = systemUpdate.vulnerabilities.medium;
  vulnBoxes[3].innerText = systemUpdate.vulnerabilities.low;
  vulnBoxes[4].innerText = systemUpdate.vulnerabilities.unknown;
};

socket.onclose = () => {
  console.log('🔌 Live stream closed.');
};

socket.onerror = (err) => {
  console.error('⚠️  Live stream error:', err);
};
