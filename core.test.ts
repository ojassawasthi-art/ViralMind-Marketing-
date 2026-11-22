import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { approvalNeeded, can } from '../src/core/authz.ts';
import type { AutonomyGrant } from '../src/core/authz.ts';
import { Platform } from '../src/core/store.ts';
import { AuthService } from '../src/core/auth.ts';
import { hotp } from '../src/security/crypto.ts';

const grant = (o: Partial<AutonomyGrant> = {}): AutonomyGrant => ({ id: 'g', actionClasses: ['outbound', 'spend'], maxSpendPerAction: 100, maxSpendTotal: 250, spentSoFar: 0, expiresAt: 10_000, revoked: false, grantedBy: 'u', ...o });

test('approval policy', () => {
  assert.equal(approvalNeeded('read', undefined, undefined, 0).needed, false);
  assert.equal(approvalNeeded('draft', undefined, undefined, 0).needed, false);
  assert.equal(approvalNeeded('outbound', undefined, undefined, 0).needed, true);
  assert.equal(approvalNeeded('outbound', undefined, grant(), 0).needed, false);
  assert.equal(approvalNeeded('outbound', undefined, grant({ revoked: true }), 0).needed, true);
  assert.equal(approvalNeeded('outbound', undefined, grant(), 20_000).needed, true, 'expired');
  assert.equal(approvalNeeded('spend', 50, grant(), 0).needed, false);
  assert.equal(approvalNeeded('spend', 150, grant(), 0).needed, true, 'per-action cap');
  assert.equal(approvalNeeded('spend', 100, grant({ spentSoFar: 200 }), 0).needed, true, 'total cap');
  assert.equal(approvalNeeded('spend', undefined, grant(), 0).needed, true, 'unknown amount');
  assert.equal(approvalNeeded('destructive', 0, grant(), 0).needed, true, 'never autonomous');
  assert.equal(approvalNeeded('critical_setting', 0, grant(), 0).needed, true);
  assert.equal(approvalNeeded('spend', 10, grant({ actionClasses: ['outbound'] }), 0).needed, true);
});
test('roles', () => { assert.ok(!can('member', 'approval:decide')); assert.ok(!can('client_viewer', 'agent:run')); assert.ok(can('owner', 'org:delete')); assert.ok(!can('admin', 'org:delete')); });

async function setup() {
  const p = new Platform(), key = randomBytes(32); let t = 1_700_000_000_000; const a = new AuthService(p, key, () => t);
  return { p, a, key, tick: (ms: number) => { t += ms; }, now: () => t };
}
test('registration, login, sessions, expiry, logout', async () => {
  const { p, a, tick } = await setup();
  await assert.rejects(a.register('bad', 'longenoughpassword', 'Org'));
  await assert.rejects(a.register('a@b.co', 'short', 'Org'));
  const r = await a.register('A@B.co', 'a-long-password-1', 'Org');
  await assert.rejects(a.register('a@b.co', 'a-long-password-1', 'Org2'));
  await assert.rejects(a.login('a@b.co', 'wrong-password-123'));
  await assert.rejects(a.login('nobody@b.co', 'a-long-password-1'));
  const s = await a.login('a@b.co', 'a-long-password-1');
  assert.equal(a.authenticate(s.token)?.orgId, r.orgId);
  assert.equal(a.authenticate('garbage'), null);
  assert.ok(![...p.sessions.keys()].includes(s.token), 'tokens stored hashed');
  tick(13 * 3600_000); assert.equal(a.authenticate(s.token), null);
  const s2 = await a.login('a@b.co', 'a-long-password-1'); a.logout(s2.token); assert.equal(a.authenticate(s2.token), null);
});
test('MFA enforcement + replay protection', async () => {
  const { a, key, tick, p } = await setup();
  const r = await a.register('m@b.co', 'a-long-password-1', 'O'); const e = a.mfaEnroll(r.userId);
  assert.ok(e.otpauthUri.startsWith('otpauth://'));
  const secret = Buffer.from((await import('../src/security/crypto.ts')).decryptSecret(key, p.users.get(r.userId)!.mfa!.secretEnc, `mfa:${r.userId}`), 'base64');
  const T0 = 1_700_000_000_000; // matches the injected clock in setup()
  assert.ok(a.mfaConfirm(r.userId, hotp(secret, Math.floor(T0 / 30000))));
  await assert.rejects(a.login('m@b.co', 'a-long-password-1'), /MFA/);
  await assert.rejects(a.login('m@b.co', 'a-long-password-1', '000000'));
  tick(30_000);
  const c = hotp(secret, Math.floor((1_700_000_030_000) / 30000));
  assert.ok((await a.login('m@b.co', 'a-long-password-1', c)).token);
  await assert.rejects(a.login('m@b.co', 'a-long-password-1', c), /MFA/, 'code reuse rejected');
});
test('tenant isolation, approvals, audit chain', async () => {
  const { p, a } = await setup();
  const o1 = (await a.register('o1@x.co', 'a-long-password-1', 'One')).orgId, o2 = (await a.register('o2@x.co', 'a-long-password-1', 'Two')).orgId;
  const u1 = [...p.users.values()].find((u) => u.email === 'o1@x.co')!;
  const ap = p.scope(o1).createApproval({ agentId: 'x', actionClass: 'outbound', summary: 's', payload: {} });
  assert.equal(p.scope(o2).approvals.size, 0); assert.equal(p.scope(o2).approvals.get(ap.id), undefined);
  assert.throws(() => p.scope(o2).decideApproval(ap.id, { id: u1.id, role: 'owner' }, true), /not_found/);
  assert.throws(() => p.scope(o1).decideApproval(ap.id, { id: 'm', role: 'member' }, true), /forbidden/);
  assert.equal(p.scope(o1).decideApproval(ap.id, { id: u1.id, role: 'owner' }, true).status, 'approved');
  assert.throws(() => p.scope(o1).decideApproval(ap.id, { id: u1.id, role: 'owner' }, false), /already_decided/);
  const sc = p.scope(o1); assert.ok(sc.verifyAudit().ok && sc.audit.length >= 3);
  (sc.audit[1] as any).action = 'tampered'; assert.deepEqual(sc.verifyAudit(), { ok: false, brokenAt: 2 });
  p.deleteOrg(o2); assert.throws(() => p.scope(o2)); assert.ok(!p.byEmail.has('o2@x.co'));
});
