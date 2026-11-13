/**
 * Sealed (encrypted) game files: held-out games whose source must not be readable in the public repo.
 *
 * A sealed file is one text line, `grue-sealed-v1:<iv>:<tag>:<ciphertext>` (base64 parts), made with
 * AES-256-GCM. The key comes from GRUE_GAMES_KEY: 32 bytes as base64 or 64 hex characters.
 * Seal with `node scripts/seal-game.mjs`; the readable source lives in a private repository.
 */

import crypto from 'node:crypto';

const PREFIX = 'grue-sealed-v1';
export const SEALED_EXT = '.enc';

/** Parse GRUE_GAMES_KEY into a 32-byte Buffer, or null when unset. Throws on a malformed key. */
export function parseKey(raw) {
  if (raw === undefined || raw === null || String(raw).trim() === '') return null;
  const s = String(raw).trim();
  const buf = /^[0-9a-f]{64}$/i.test(s) ? Buffer.from(s, 'hex') : Buffer.from(s, 'base64');
  if (buf.length !== 32) throw new Error('GRUE_GAMES_KEY must be 32 bytes (base64 or 64 hex characters).');
  return buf;
}

const keyCache = new Map();

/** The parsed key from a config object's GAMES_KEY (null when unset or malformed; a malformed key is logged once). */
export function keyFromConfig(cfg) {
  const raw = cfg?.GAMES_KEY ?? '';
  if (!keyCache.has(raw)) {
    let key = null;
    try { key = parseKey(raw); } catch (err) { console.warn(`[sealed] ${err.message}`); }
    keyCache.set(raw, key);
  }
  return keyCache.get(raw);
}

/** Encrypt `plaintext` (string or Buffer) with a 32-byte key. Returns the sealed text line. */
export function seal(plaintext, key) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(Buffer.from(plaintext)), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}:${iv.toString('base64')}:${tag.toString('base64')}:${ct.toString('base64')}\n`;
}

/** Decrypt a sealed text line. Throws if the key is wrong or the file was altered. */
export function unseal(text, key) {
  if (!key) throw new Error('This game is sealed and the server has no GRUE_GAMES_KEY.');
  const parts = String(text).trim().split(':');
  if (parts.length !== 4 || parts[0] !== PREFIX) throw new Error('Not a sealed Grue game file.');
  const [iv, tag, ct] = parts.slice(1).map((p) => Buffer.from(p, 'base64'));
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(ct), decipher.final()]);
  } catch {
    throw new Error('Cannot unseal the game: wrong GRUE_GAMES_KEY or a damaged file.');
  }
}
