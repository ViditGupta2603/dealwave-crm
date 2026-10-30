import dns from 'dns/promises';
import http from 'http';
import https from 'https';
import net from 'net';
import crypto from 'crypto';
import { config } from '../config.js';

function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return (
      a === 10 ||
      a === 127 ||
      a === 0 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) ||
      a >= 224
    );
  }
  const v = ip.toLowerCase();
  if (v === '::1' || v === '::') return true;
  if (v.startsWith('fe80') || v.startsWith('fc') || v.startsWith('fd')) return true;
  if (v.startsWith('::ffff:')) return isPrivateIp(v.slice(7));
  return false;
}

export async function assertPublicUrl(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('Invalid webhook URL');
  }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Webhook URL must be http or https');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addrs = net.isIP(host) ? [{ address: host, family: net.isIP(host) }] : await dns.lookup(host, { all: true });
  if (!addrs.length) throw new Error('Webhook host did not resolve');
  if (config.ALLOW_PRIVATE_WEBHOOKS !== 'true' && addrs.some((a) => isPrivateIp(a.address))) {
    throw new Error('Webhook URL points to a private or internal address');
  }
  return { url, ip: addrs[0].address, family: addrs[0].family };
}

/** POSTs JSON to a tenant-supplied URL. Validates the address and pins the connection to it (blocks SSRF / DNS rebinding). */
export async function postJson(rawUrl, payload, secret) {
  const { url, ip, family } = await assertPublicUrl(rawUrl);
  const body = JSON.stringify(payload);
  const headers = {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
    'User-Agent': 'DealwaveCRM-Webhook/1.0',
  };
  if (secret) headers['X-Dealwave-Signature'] = 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');
  const lib = url.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const req = lib.request(
      {
        hostname: url.hostname,
        port: url.port || undefined,
        path: url.pathname + url.search,
        method: 'POST',
        headers,
        timeout: 5000,
        lookup: (_h, opts, cb) => (opts && opts.all ? cb(null, [{ address: ip, family }]) : cb(null, ip, family)),
      },
      (res) => {
        res.resume();
        res.on('end', () =>
          res.statusCode && res.statusCode < 400
            ? resolve({ status: res.statusCode })
            : reject(new Error(`Webhook responded with HTTP ${res.statusCode}`)),
        );
      },
    );
    req.on('timeout', () => req.destroy(new Error('Webhook timed out after 5s')));
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}
