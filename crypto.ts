import { createCipheriv, createDecipheriv, createHmac, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';

export function parseMasterKey(b64: string): Buffer {
  const k = Buffer.from(b64, 'base64');
  if (k.length !== 32) throw new Error('MASTER_KEY must decode to exactly 32 bytes (openssl rand -base64 32)');
  return k;
}

/** AES-256-GCM. `aad` binds ciphertext to its owner (e.g. orgId:connectorId) so blobs can't be swapped between rows. */
export function encryptSecret(key: Buffer, plaintext: string, aad: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv);
  c.setAAD(Buffer.from(aad));
  const ct = Buffer.concat([c.update(plaintext, 'utf8'), c.final()]);
  return ['v1', iv.toString('base64url'), c.getAuthTag().toString('base64url'), ct.toString('base64url')].join('.');
}

export function decryptSecret(key: Buffer, blob: string, aad: string): string {
  const [v, iv, tag, ct] = blob.split('.');
  if (v !== 'v1' || !iv || !tag || ct === undefined) throw new Error('invalid ciphertext format');
  const d = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
  d.setAAD(Buffer.from(aad));
  d.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([d.update(Buffer.from(ct, 'base64url')), d.final()]).toString('utf8');
}

const SCRYPT = { N: 32768, r: 8, p: 1 };
function scrypt(pw: string, salt: Buffer, N: number, r: number, p: number): Promise<Buffer> {
  return new Promise((res, rej) => scryptCb(pw, salt, 64, { N, r, p, maxmem: 128 * N * r * 2 }, (e, k) => (e ? rej(e) : res(k))));
}

/** scrypt (RFC 7914) from node:crypto. Argon2id is preferred once a vetted dependency is allowed (see docs/SECURITY.md). */
export async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16);
  const h = await scrypt(pw, salt, SCRYPT.N, SCRYPT.r, SCRYPT.p);
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64'), h.toString('base64')].join('$');
}

export async function verifyPassword(pw: string, stored: string): Promise<boolean> {
  const [alg, n, r, p, s, h] = stored.split('$');
  if (alg !== 'scrypt' || !n || !r || !p || !s || !h) return false;
  const N = Number(n), R = Number(r), P = Number(p);
  if (!Number.isInteger(N) || N > 2 ** 20 || N < 2 || (N & (N - 1)) !== 0 || R > 32 || P > 16) return false;
  const expected = Buffer.from(h, 'base64');
  const actual = await scrypt(pw, Buffer.from(s, 'base64'), N, R, P);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function hotp(secret: Buffer, counter: number, digits = 6): string {
  const b = Buffer.alloc(8);
  b.writeBigUInt64BE(BigInt(counter));
  const h = createHmac('sha1', secret).update(b).digest();
  const o = h[h.length - 1]! & 15;
  const code = ((h[o]! & 0x7f) << 24) | (h[o + 1]! << 16) | (h[o + 2]! << 8) | h[o + 3]!;
  return String(code % 10 ** digits).padStart(digits, '0');
}

/** Returns the matched time-step counter (store it to reject replays) or null. */
export function verifyTotp(secret: Buffer, code: string, nowMs: number, lastCounter = -1, window = 1, step = 30): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const base = Math.floor(nowMs / 1000 / step);
  for (let i = -window; i <= window; i++) {
    const c = base + i;
    if (c <= lastCounter) continue;
    const exp = Buffer.from(hotp(secret, c));
    const got = Buffer.from(code);
    if (exp.length === got.length && timingSafeEqual(exp, got)) return c;
  }
  return null;
}

export function base32Encode(buf: Buffer): string {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0, val = 0, out = '';
  for (const byte of buf) {
    val = (val << 8) | byte; bits += 8;
    while (bits >= 5) { out += A[(val >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += A[(val << (5 - bits)) & 31];
  return out;
}

export function randomToken(bytes = 32): string { return randomBytes(bytes).toString('base64url'); }
