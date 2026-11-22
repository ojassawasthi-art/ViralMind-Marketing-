export type Role = 'owner' | 'admin' | 'manager' | 'member' | 'client_viewer';
export type ActionClass = 'read' | 'draft' | 'outbound' | 'spend' | 'destructive' | 'critical_setting';
export type Permission = 'capability:read' | 'capability:run' | 'agent:run' | 'approval:read' | 'approval:decide' | 'integration:manage'
  | 'audit:read' | 'org:export' | 'org:delete' | 'usage:read' | 'settings:write' | 'autonomy:grant';

const READ: Permission[] = ['capability:read', 'approval:read', 'usage:read'];
const MATRIX: Record<Role, Permission[]> = {
  client_viewer: ['capability:read', 'approval:read'],
  member: [...READ, 'capability:run', 'agent:run'],
  manager: [...READ, 'capability:run', 'agent:run', 'approval:decide', 'audit:read'],
  admin: [...READ, 'capability:run', 'agent:run', 'approval:decide', 'audit:read', 'integration:manage', 'org:export', 'settings:write'],
  owner: [...READ, 'capability:run', 'agent:run', 'approval:decide', 'audit:read', 'integration:manage', 'org:export', 'org:delete', 'settings:write', 'autonomy:grant'],
};
export const can = (role: Role, p: Permission): boolean => MATRIX[role].includes(p);
export const ROLES = Object.keys(MATRIX) as Role[];

export interface AutonomyGrant {
  id: string; actionClasses: ('outbound' | 'spend')[]; maxSpendPerAction: number; maxSpendTotal: number;
  spentSoFar: number; expiresAt: number; revoked: boolean; grantedBy: string;
}

/**
 * Policy (docs/01-architecture.md): read/draft never need approval. destructive and critical_setting ALWAYS need a human
 * decision, even in Autonomous mode. outbound/spend need approval unless a valid, unexpired, unrevoked, in-budget grant covers them.
 */
export function approvalNeeded(cls: ActionClass, spend: number | undefined, grant: AutonomyGrant | undefined, now: number): { needed: boolean; reason: string } {
  if (cls === 'read' || cls === 'draft') return { needed: false, reason: 'non-impacting action' };
  if (cls === 'destructive' || cls === 'critical_setting') return { needed: true, reason: 'always requires per-action human approval' };
  const g = grant;
  if (!g || g.revoked || g.expiresAt <= now) return { needed: true, reason: 'no valid autonomy grant' };
  if (!g.actionClasses.includes(cls)) return { needed: true, reason: `grant does not cover ${cls}` };
  if (cls === 'spend') {
    if (spend === undefined || !(spend >= 0)) return { needed: true, reason: 'spend amount unknown' };
    if (spend > g.maxSpendPerAction || g.spentSoFar + spend > g.maxSpendTotal) return { needed: true, reason: 'spend exceeds grant limits' };
  }
  return { needed: false, reason: 'covered by autonomy grant' };
}
