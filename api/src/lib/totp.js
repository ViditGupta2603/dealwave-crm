import crypto from 'crypto';
import QRCode from 'qrcode';
import { config } from '../config.js';

/** Time-based one-time passwords (RFC 6238), compatible with Google Authenticator, Microsoft Authenticator, Authy and 1Password. */
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export const STEP_SECONDS = 30;

export function base32Encode(buf) {
  let bits = 0,
    value = 0,
    out = '';
  for (const b of buf) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s) {
  const clean = s.toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0,
    value = 0;
  const out = [];
  for (const ch of clean) {
    value = (value << 5) | B32.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export const newSecret = () => base32Encode(crypto.randomBytes(20));

export function hotp(secret, counter, digits = 6) {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac('sha1', secret).update(msg).digest();
  const o = h[h.length - 1] & 0xf;
  const code = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(code % 10 ** digits).padStart(digits, '0');
}

export const stepAt = (ms) => Math.floor(ms / 1000 / STEP_SECONDS);
export const codeAt = (base32, ms = Date.now()) => hotp(base32Decode(base32), stepAt(ms));

const eq = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

/**
 * Checks a 6-digit code, allowing one 30-second step either side for clock drift.
 * Returns the matched step so the caller can refuse to accept the same code twice.
 */
export function verifyCode(base32, code, lastUsedStep, ms = Date.now()) {
  const clean = String(code).replace(/\s/g, '');
  if (!/^\d{6}$/.test(clean)) return null;
  const secret = base32Decode(base32);
  const now = stepAt(ms);
  for (const step of [now, now - 1, now + 1]) {
    if (lastUsedStep !== null && step <= lastUsedStep) continue;
    if (eq(hotp(secret, step), clean)) return step;
  }
  return null;
}

export function otpauthUrl(account, issuer, base32) {
  const label = encodeURIComponent(`${issuer}:${account}`);
  return `otpauth://totp/${label}?secret=${base32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=${STEP_SECONDS}`;
}

export const qrDataUrl = (text) => QRCode.toDataURL(text, { margin: 1, width: 220, errorCorrectionLevel: 'M' });

// ---- Secrets are stored encrypted (AES-256-GCM), never as plain text ----
// Deliberately NOT renamed with the product: this string feeds the encryption key, and changing it would make every
// two-step secret already stored in an existing database unreadable.
const TOTP_KEY_SALT = 'pravah-totp-v1';
const key = () =>
  crypto
    .createHash('sha256')
    .update(TOTP_KEY_SALT + ':' + (config.TOTP_ENCRYPTION_KEY || config.JWT_SECRET))
    .digest();

export function encryptSecret(base32) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([c.update(base32, 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), enc].map((b) => b.toString('base64')).join('.');
}

export function decryptSecret(stored) {
  const [iv, tag, enc] = stored.split('.').map((p) => Buffer.from(p, 'base64'));
  const d = crypto.createDecipheriv('aes-256-gcm', key(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]).toString('utf8');
}

// ---- Backup codes: shown once, stored only as hashes, each usable once ----
export function newBackupCodes(n = 8) {
  return Array.from({ length: n }, () => {
    const h = crypto.randomBytes(5).toString('hex');
    return `${h.slice(0, 5)}-${h.slice(5)}`;
  });
}
export const normalizeBackup = (c) => c.toLowerCase().replace(/[^a-f0-9]/g, '');
export const hashBackup = (c) => crypto.createHash('sha256').update(normalizeBackup(c)).digest('hex');
