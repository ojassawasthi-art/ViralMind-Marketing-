import { randomUUID } from 'node:crypto';
import { Platform, sha256hex } from './store.ts';
import type { User } from './store.ts';
import { base32Encode, decryptSecret, encryptSecret, hashPassword, randomToken, verifyPassword, verifyTotp } from '../security/crypto.ts';
import { randomBytes } from 'node:crypto';
import type { Role } from './authz.ts';

export const SESSION_TTL_MS = 12 * 3600_000;
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/;
let DUMMY: string | undefined;

export class AuthError extends Error { code: string; constructor(code: string, msg: string) { super(msg); this.code = code; } }

export class AuthService {
  p: Platform; key: Buffer; now: () => number;
  constructor(p: Platform, key: Buffer, now: () => number = Date.now) { this.p = p; this.key = key; this.now = now; }

  async register(email: string, password: string, orgName: string): Promise<{ userId: string; orgId: string }> {
    const e = email.trim().toLowerCase();
    if (!EMAIL.test(e)) throw new AuthError('invalid_email', 'invalid email');
    if (password.length < 12 || password.length > 256) throw new AuthError('weak_password', 'password must be 12–256 characters');
    if (orgName.length < 1 || orgName.length > 120) throw new AuthError('invalid_org', 'organization name required');
    if (this.p.byEmail.has(e)) throw new AuthError('exists', 'registration failed'); // generic message
    const user: User = { id: randomUUID(), email: e, passwordHash: await hashPassword(password), createdAt: this.now() };
    return { userId: user.id, orgId: this.p.createOrgWithOwner(user, orgName) };
  }

  async login(email: string, password: string, totp?: string): Promise<{ token: string; orgId: string; userId: string; role: Role }> {
    DUMMY ??= await hashPassword('dummy-password-for-timing');
    const id = this.p.byEmail.get(email.trim().toLowerCase());
    const user = id ? this.p.users.get(id) : undefined;
    const ok = await verifyPassword(password, user?.passwordHash ?? DUMMY);
    if (!user || !ok) throw new AuthError('invalid_credentials', 'invalid credentials');
    if (user.mfa?.enabled) {
      const secret = Buffer.from(decryptSecret(this.key, user.mfa.secretEnc, `mfa:${user.id}`), 'base64');
      const c = verifyTotp(secret, totp ?? '', this.now(), user.mfa.lastCounter);
      if (c === null) throw new AuthError('mfa_required', 'valid MFA code required');
      user.mfa.lastCounter = c; // replay protection
    }
    const m = this.p.memberships.find((x) => x.userId === user.id);
    if (!m) throw new AuthError('no_membership', 'no organization');
    const token = randomToken();
    this.p.sessions.set(sha256hex(token), { userId: user.id, orgId: m.orgId, expiresAt: this.now() + SESSION_TTL_MS });
    this.p.scope(m.orgId).record(`user:${user.id}`, 'auth.login');
    return { token, orgId: m.orgId, userId: user.id, role: m.role };
  }

  authenticate(token: string | undefined): { userId: string; orgId: string; role: Role } | null {
    if (!token) return null;
    const h = sha256hex(token);
    const s = this.p.sessions.get(h);
    if (!s) return null;
    if (s.expiresAt <= this.now()) { this.p.sessions.delete(h); return null; }
    const role = this.p.roleOf(s.orgId, s.userId);
    return role ? { userId: s.userId, orgId: s.orgId, role } : null;
  }
  logout(token: string): void { this.p.sessions.delete(sha256hex(token)); }

  mfaEnroll(userId: string): { secretBase32: string; otpauthUri: string } {
    const u = this.p.users.get(userId); if (!u) throw new AuthError('not_found', 'user');
    const secret = randomBytes(20);
    u.mfa = { secretEnc: encryptSecret(this.key, secret.toString('base64'), `mfa:${u.id}`), enabled: false, lastCounter: -1 };
    const b32 = base32Encode(secret);
    return { secretBase32: b32, otpauthUri: `otpauth://totp/VIRALMIND:${encodeURIComponent(u.email)}?secret=${b32}&issuer=VIRALMIND` };
  }
  mfaConfirm(userId: string, code: string): boolean {
    const u = this.p.users.get(userId); if (!u?.mfa) return false;
    const c = verifyTotp(Buffer.from(decryptSecret(this.key, u.mfa.secretEnc, `mfa:${u.id}`), 'base64'), code, this.now(), u.mfa.lastCounter);
    if (c === null) return false;
    u.mfa.enabled = true; u.mfa.lastCounter = c; return true;
  }
  async reauth(userId: string, password: string): Promise<boolean> {
    const u = this.p.users.get(userId); return !!u && verifyPassword(password, u.passwordHash);
  }
}
