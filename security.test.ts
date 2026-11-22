import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { base32Encode, decryptSecret, encryptSecret, hashPassword, hotp, verifyPassword, verifyTotp } from '../src/security/crypto.ts';
import { assertSafeUrl, isPrivateIp, SsrfError } from '../src/security/ssrf.ts';
import { RateLimiter } from '../src/security/ratelimit.ts';
import { containsSecret, redact } from '../src/security/redact.ts';

test('AES-GCM roundtrip, AAD binding and tamper detection', () => {
  const k = randomBytes(32), blob = encryptSecret(k, 'tok-123', 'org1:meta');
  assert.equal(decryptSecret(k, blob, 'org1:meta'), 'tok-123');
  assert.throws(() => decryptSecret(k, blob, 'org2:meta'));
  assert.throws(() => decryptSecret(randomBytes(32), blob, 'org1:meta'));
  const parts = blob.split('.'); parts[3] = Buffer.from('x' + parts[3]).toString('base64url');
  assert.throws(() => decryptSecret(k, parts.join('.'), 'org1:meta'));
  assert.ok(!blob.includes('tok-123'));
});
test('password hashing', async () => {
  const h = await hashPassword('correct horse battery');
  assert.ok(await verifyPassword('correct horse battery', h));
  assert.ok(!(await verifyPassword('wrong', h)));
  assert.ok(!(await verifyPassword('x', 'scrypt$2147483648$8$1$aa$bb')));
});
test('TOTP matches RFC 6238 vector and rejects replay', () => {
  const secret = Buffer.from('12345678901234567890');
  assert.equal(hotp(secret, Math.floor(59 / 30), 8), '94287082');
  const t = 1_700_000_000_000, code = hotp(secret, Math.floor(t / 30000));
  const c = verifyTotp(secret, code, t);
  assert.equal(c, Math.floor(t / 30000));
  assert.equal(verifyTotp(secret, code, t, c!), null);
  assert.equal(verifyTotp(secret, '000000', t), null);
  assert.equal(base32Encode(Buffer.from('foobar')), 'MZXW6YTBOI');
});
test('SSRF: private ranges, IPv6 forms, schemes, DNS answers', async () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', '::', 'fe80::1', 'fd00::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '64:ff9b::1', '0:0:0:0:0:0:0:1']) assert.ok(isPrivateIp(ip), ip);
  for (const ip of ['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111']) assert.ok(!isPrivateIp(ip), ip);
  const pub = async () => ['93.184.216.34'], priv = async () => ['10.0.0.5'], mixed = async () => ['93.184.216.34', '127.0.0.1'];
  await assert.doesNotReject(assertSafeUrl('https://example.com/a', { resolver: pub }));
  for (const u of ['file:///etc/passwd', 'ftp://x.com', 'http://localhost/', 'http://a.internal/', 'http://user:pw@example.com/', 'http://example.com:8080/', 'http://2130706433/', 'http://[::1]/', 'not a url'])
    await assert.rejects(assertSafeUrl(u, { resolver: pub }), SsrfError, u);
  await assert.rejects(assertSafeUrl('http://evil.test/', { resolver: priv }), SsrfError);
  await assert.rejects(assertSafeUrl('http://evil.test/', { resolver: mixed }), SsrfError);
});
test('rate limiter and redaction', () => {
  let t = 0; const rl = new RateLimiter(2, 1, () => t);
  assert.ok(rl.take('a') && rl.take('a') && !rl.take('a')); t = 1500; assert.ok(rl.take('a')); assert.ok(rl.take('b'));
  const r = redact({ password: 'p', nested: { apiKey: 'k', note: 'key sk-abcdefghijklmnopqrstuv here' }, ok: 1 }) as any;
  assert.equal(r.password, '[REDACTED]'); assert.equal(r.nested.apiKey, '[REDACTED]'); assert.ok(!r.nested.note.includes('sk-abc')); assert.equal(r.ok, 1);
  assert.ok(containsSecret('Bearer abcdefghijklmnop1234'));
});
