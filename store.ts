import { createHash, randomUUID } from 'node:crypto';
import type { ActionClass, AutonomyGrant, Role } from './authz.ts';
import { can } from './authz.ts';

/** In-memory tenant store. EVERY data access goes through OrgScope, which is bound to one orgId taken from the session,
 *  never from client input. Postgres equivalent (with RLS) is drafted in db/migrations but not wired — see README status. */

export interface User { id: string; email: string; passwordHash: string; mfa?: { secretEnc: string; enabled: boolean; lastCounter: number }; createdAt: number }
export interface Membership { orgId: string; userId: string; role: Role }
export interface Approval {
  id: string; orgId: string; agentId: string; actionClass: ActionClass; summary: string; payload: unknown; spend?: number;
  status: 'pending' | 'approved' | 'rejected'; decidedBy?: string; decidedAt?: number; createdAt: number;
  execution: 'not_executed' | 'executed' | 'no_connector' | 'failed'; executionNote?: string;
}
export interface AuditEvent { seq: number; ts: number; actor: string; action: string; target?: string; meta?: unknown; prevHash: string; hash: string }
export interface UsageRecord { ts: number; kind: 'model' | 'capability'; provider?: string; model?: string; tokensIn: number; tokensOut: number; mayIncurCharge: boolean; label: string }
export interface ConnectorGrant { connectorId: string; secretEnc: string; scopes: string[]; createdAt: number; revokedAt?: number }
export interface SyncEvent { ts: number; connectorId: string; direction: 'inbound' | 'outbound'; status: 'ok' | 'rejected' | 'error'; detail: string }

const sha = (s: string): string => createHash('sha256').update(s).digest('hex');
const GENESIS = '0'.repeat(64);

export class OrgScope {
  readonly orgId: string;
  approvals = new Map<string, Approval>();
  audit: AuditEvent[] = [];
  usage: UsageRecord[] = [];
  grants = new Map<string, ConnectorGrant>();
  sync: SyncEvent[] = [];
  nonces = new Map<string, number>();
  autonomy: AutonomyGrant | undefined;
  constructor(orgId: string) { this.orgId = orgId; }

  record(actor: string, action: string, target?: string, meta?: unknown): AuditEvent {
    const prev = this.audit[this.audit.length - 1];
    const ev = { seq: this.audit.length + 1, ts: Date.now(), actor, action, target, meta, prevHash: prev?.hash ?? GENESIS };
    const e: AuditEvent = { ...ev, hash: sha(ev.prevHash + JSON.stringify([ev.seq, ev.ts, actor, action, target ?? null, meta ?? null])) };
    this.audit.push(e);
    return e;
  }
  verifyAudit(): { ok: boolean; brokenAt?: number } {
    let prev = GENESIS;
    for (const e of this.audit) {
      if (e.prevHash !== prev || e.hash !== sha(prev + JSON.stringify([e.seq, e.ts, e.actor, e.action, e.target ?? null, e.meta ?? null]))) return { ok: false, brokenAt: e.seq };
      prev = e.hash;
    }
    return { ok: true };
  }
  createApproval(a: Pick<Approval, 'agentId' | 'actionClass' | 'summary' | 'payload' | 'spend'>): Approval {
    const ap: Approval = { ...a, id: randomUUID(), orgId: this.orgId, status: 'pending', createdAt: Date.now(), execution: 'not_executed' };
    this.approvals.set(ap.id, ap);
    this.record(`agent:${a.agentId}`, 'approval.requested', ap.id, { actionClass: a.actionClass, spend: a.spend });
    return ap;
  }
  decideApproval(id: string, user: { id: string; role: Role }, approve: boolean): Approval {
    if (!can(user.role, 'approval:decide')) throw new Error('forbidden');
    const ap = this.approvals.get(id);
    if (!ap) throw new Error('not_found');
    if (ap.status !== 'pending') throw new Error('already_decided');
    ap.status = approve ? 'approved' : 'rejected'; ap.decidedBy = user.id; ap.decidedAt = Date.now();
    this.record(`user:${user.id}`, approve ? 'approval.approved' : 'approval.rejected', id);
    return ap;
  }
  addUsage(u: Omit<UsageRecord, 'ts'>): void { this.usage.push({ ...u, ts: Date.now() }); }
  usageSummary(): { calls: number; tokensIn: number; tokensOut: number; paidCapableCalls: number; byProvider: Record<string, number> } {
    const byProvider: Record<string, number> = {};
    let tin = 0, tout = 0, paid = 0;
    for (const u of this.usage) { tin += u.tokensIn; tout += u.tokensOut; if (u.mayIncurCharge) paid++; byProvider[u.provider ?? u.kind] = (byProvider[u.provider ?? u.kind] ?? 0) + 1; }
    return { calls: this.usage.length, tokensIn: tin, tokensOut: tout, paidCapableCalls: paid, byProvider };
  }
  export(): unknown {
    return { orgId: this.orgId, exportedAt: new Date().toISOString(), approvals: [...this.approvals.values()], audit: this.audit, usage: this.usage,
      connectors: [...this.grants.values()].map((g) => ({ connectorId: g.connectorId, scopes: g.scopes, createdAt: g.createdAt, revokedAt: g.revokedAt })), // secrets never exported
      syncHistory: this.sync, autonomy: this.autonomy };
  }
}

export class Platform {
  users = new Map<string, User>();
  byEmail = new Map<string, string>();
  orgs = new Map<string, { id: string; name: string; scope: OrgScope; createdAt: number }>();
  memberships: Membership[] = [];
  sessions = new Map<string, { userId: string; orgId: string; expiresAt: number }>();

  createOrgWithOwner(user: User, orgName: string): string {
    const orgId = randomUUID();
    this.users.set(user.id, user); this.byEmail.set(user.email, user.id);
    const scope = new OrgScope(orgId);
    this.orgs.set(orgId, { id: orgId, name: orgName, scope, createdAt: Date.now() });
    this.memberships.push({ orgId, userId: user.id, role: 'owner' });
    scope.record(`user:${user.id}`, 'org.created', orgId);
    return orgId;
  }
  scope(orgId: string): OrgScope { const o = this.orgs.get(orgId); if (!o) throw new Error('not_found'); return o.scope; }
  roleOf(orgId: string, userId: string): Role | undefined { return this.memberships.find((m) => m.orgId === orgId && m.userId === userId)?.role; }
  deleteOrg(orgId: string): void {
    this.orgs.delete(orgId);
    const gone = new Set(this.memberships.filter((m) => m.orgId === orgId).map((m) => m.userId));
    this.memberships = this.memberships.filter((m) => m.orgId !== orgId);
    for (const [h, s] of this.sessions) if (s.orgId === orgId) this.sessions.delete(h);
    for (const uid of gone) if (!this.memberships.some((m) => m.userId === uid)) { const u = this.users.get(uid); if (u) this.byEmail.delete(u.email); this.users.delete(uid); }
  }
}
export { sha as sha256hex };
