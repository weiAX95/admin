import net from 'node:net';

export function normalizeLoginIp(value) {
  const raw = String(value || '').trim();
  const normalized = raw.toLowerCase().startsWith('::ffff:') ? raw.slice(7) : raw;
  return net.isIP(normalized) ? normalized.toLowerCase() : null;
}

export function parseLoginIpAllowlist(value) {
  if (!Array.isArray(value) || value.length > 30) return null;
  const addresses = value.map(normalizeLoginIp);
  if (addresses.some(address => !address)) return null;
  return [...new Set(addresses)];
}

export function requestLoginIp(req, env = process.env) {
  const peer = normalizeLoginIp(req.socket.remoteAddress);
  const trusted = String(env.TRUSTED_PROXY_IPS || '').split(',').map(normalizeLoginIp).filter(Boolean);
  if (!peer || !trusted.includes(peer)) return peer || 'unknown';
  // A configured reverse proxy must append the actual peer to X-Forwarded-For.
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',').map(value => value.trim());
  return normalizeLoginIp(forwarded.at(-1)) || peer;
}
