import http from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import type { Platform } from '../core/store.ts';
import type { AuthService } from '../core/auth.ts';
import { AuthError } from '../core/auth.ts';
import type { Registry } from '../capabilities/registry.ts';
import { EXAMPLES, WORKFLOWS } from '../capabilities/workflows.ts';
import { TEMPLATE_EXAMPLE, isTemplateCapability, runTemplate, templateInput } from '../capabilities/templates.ts';
import type { ModelRouter } from '../ai/router.ts';
import { NoModelAvailable } from '../ai/router.ts';
import type { AgentSpec, ToolDef } from '../ai/runtime.ts';
import { llmPlanner, runAgent } from '../ai/runtime.ts';
import { CATALOG } from '../integrations/connector.ts';
import type { ConnectorManager } from '../integrations/connector.ts';
import { can } from '../core/authz.ts';
import type { Permission, Role } from '../core/authz.ts';
import { RateLimiter } from '../security/ratelimit.ts';
import { log } from '../security/redact.ts';

export interface Deps { platform: Platform; auth: AuthService; registry: Registry; router: ModelRouter; connectors: ConnectorManager; tools: Map<string, ToolDef>; agents: AgentSpec[]; now?: () => number }
interface Ctx { req: http.IncomingMessage; res: http.ServerResponse; body: any; raw: string; params: Record<string, string>; q: URLSearchParams; s?: { userId: string; orgId: string; role: Role }; token?: string }
type Handler = (c: Ctx) => Promise<unknown> | unknown;
class HttpError extends Error { status: number; constructor(status: number, msg: string) { super(msg); this.status = status; } }
const MAX_BODY = 1_000_000;
const PUB = (f: string): string => fileURLToPath(new URL(`../../public/${f}`, import.meta.url));
const STATIC: Record<string, [string, string]> = { '/': ['index.html', 'text/html; charset=utf-8'], '/assets/app.js': ['app.js', 'text/javascript; charset=utf-8'], '/assets/app.css': ['app.css', 'text/css; charset=utf-8'] };
const HEADERS = { 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'x-frame-options': 'DENY', 'cross-origin-opener-policy': 'same-origin',
  'content-security-policy': "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'self'; frame-ancestors 'none'" };

export function createApp(d: Deps): http.Server {
  const now = d.now ?? Date.now;
  const authLimiter = new RateLimiter(10, 10 / 60), apiLimiter = new RateLimiter(120, 2);
  const routes: { method: string; re: RegExp; perm?: Permission | 'public' | 'authed'; h: Handler }[] = [];
  const route = (method: string, path: string, perm: Permission | 'public' | 'authed', h: Handler): void => { routes.push({ method, re: new RegExp('^' + path.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$'), perm, h }); };
  const scopeOf = (c: Ctx) => d.platform.scope(c.s!.orgId);
  const bad = (m: string, s = 400): never => { throw new HttpError(s, m); };
  const need = <T>(v: T | undefined | null, m: string): T => (v === undefined || v === null ? bad(m) : v);
  const str = (v: unknown, m: string, max = 500): string => (typeof v === 'string' && v.length > 0 && v.length <= max ? v : bad(m));
  const ip = (c: Ctx): string => c.req.socket.remoteAddress ?? 'unknown';

  route('GET', '/healthz', 'public', () => ({ ok: true }));
  route('POST', '/api/auth/register', 'public', async (c) => {
    if (!authLimiter.take(`reg:${ip(c)}`)) bad('rate limited', 429);
    try { const r = await d.auth.register(str(c.body.email, 'email', 320), str(c.body.password, 'password', 256), str(c.body.orgName, 'orgName', 120)); return { userId: r.userId, orgId: r.orgId }; }
    catch (e) { if (e instanceof AuthError) bad(e.message, e.code === 'exists' ? 409 : 400); throw e; }
  });
  route('POST', '/api/auth/login', 'public', async (c) => {
    if (!authLimiter.take(`login:${ip(c)}`) || !authLimiter.take(`login:${String(c.body.email).toLowerCase()}`)) bad('rate limited', 429);
    try { const r = await d.auth.login(str(c.body.email, 'email', 320), str(c.body.password, 'password', 256), typeof c.body.totp === 'string' ? c.body.totp : undefined); return { token: r.token, role: r.role }; }
    catch (e) { if (e instanceof AuthError) { throw new HttpError(401, e.code === 'mfa_required' ? 'mfa_required' : 'invalid credentials'); } throw e; }
  });
  route('POST', '/api/auth/logout', 'authed', (c) => { d.auth.logout(c.token!); return { ok: true }; });
  route('GET', '/api/me', 'authed', (c) => { const u = d.platform.users.get(c.s!.userId)!; return { email: u.email, role: c.s!.role, org: d.platform.orgs.get(c.s!.orgId)!.name, mfaEnabled: !!u.mfa?.enabled }; });
  route('POST', '/api/auth/mfa/enroll', 'authed', (c) => d.auth.mfaEnroll(c.s!.userId));
  route('POST', '/api/auth/mfa/confirm', 'authed', (c) => { if (!d.auth.mfaConfirm(c.s!.userId, str(c.body.code, 'code', 8))) bad('invalid code', 401); scopeOf(c).record(`user:${c.s!.userId}`, 'auth.mfa_enabled'); return { enabled: true }; });

  route('GET', '/api/divisions', 'capability:read', () => d.registry.divisions());
  route('GET', '/api/capabilities', 'capability:read', (c) => d.registry.search({ division: c.q.get('division') ?? undefined, q: c.q.get('q') ?? undefined, status: c.q.get('status') ?? undefined })
    .map((x) => ({ id: x.id, name: x.name, kind: x.kind, division: x.division, department: x.department, execution_mode: x.execution_mode, cost_class: x.cost_class, approval_required: x.approval_required, status: x.implementation_status, runnable: !!x.workflow || isTemplateCapability(x), archetype: x.archetype })));
  route('GET', '/api/capabilities/:id', 'capability:read', (c) => { const x = need(d.registry.byId.get(c.params.id!), 'not found'); return { ...x, inputExample: x.workflow ? EXAMPLES[x.workflow] : isTemplateCapability(x) ? TEMPLATE_EXAMPLE : undefined }; });
  route('POST', '/api/capabilities/:id/run', 'capability:run', async (c) => {
    const cap = need(d.registry.byId.get(c.params.id!), 'not found');
    if (!cap.workflow && isTemplateCapability(cap)) {
      const v = templateInput(c.body.input); if (!v.ok) bad(v.error, 422);
      const r = await runTemplate(cap, v.ok ? (v.value as never) : (undefined as never), d.router); const sc = scopeOf(c);
      if (r.model) sc.addUsage({ kind: 'model', provider: r.model.providerId, model: r.model.model, tokensIn: r.tokens!.in, tokensOut: r.tokens!.out, mayIncurCharge: r.model.mayIncurCharge, label: r.model.label });
      else sc.addUsage({ kind: 'capability', tokensIn: 0, tokensOut: 0, mayIncurCharge: false, label: cap.id });
      sc.record(`user:${c.s!.userId}`, 'capability.run', cap.id, { mode: r.mode }); return r;
    }
    if (!cap.workflow) throw new HttpError(501, `not_implemented: "${cap.name}" has status ${cap.implementation_status}`);
    const w = WORKFLOWS[cap.workflow]!; const v = w.schema(c.body.input);
    if (!v.ok) bad(v.error, 422);
    let out: unknown; try { out = w.run(v.ok ? v.value : undefined); } catch (e) { bad((e as Error).message, 422); }
    const sc = scopeOf(c); sc.addUsage({ kind: 'capability', tokensIn: 0, tokensOut: 0, mayIncurCharge: false, label: cap.id }); sc.record(`user:${c.s!.userId}`, 'capability.run', cap.id);
    return { capability: cap.id, cost: 'no charge (deterministic, local)', result: out };
  });

  route('GET', '/api/models/status', 'capability:read', async () => ({ providers: await d.router.status(), policy: d.router.policy }));
  route('POST', '/api/chief/route', 'agent:run', (c) => ({ routing: d.registry.routeDivision(str(c.body.goal, 'goal', 2000)).slice(0, 5), method: 'deterministic keyword scoring (no model used)' }));
  route('GET', '/api/agents', 'capability:read', () => d.agents.map((a) => ({ id: a.id, name: a.name, role: a.role, division: a.division, tools: a.tools, budget: a.budget })));
  route('POST', '/api/agents/:id/run', 'agent:run', async (c) => {
    const spec = need(d.agents.find((a) => a.id === decodeURIComponent(c.params.id!)), 'unknown agent'); const goal = str(c.body.goal, 'goal', 4000); const sc = scopeOf(c);
    const decisions: string[] = [];
    const planner = llmPlanner(d.router, spec, d.tools, (dec, tin, tout) => { decisions.push(dec.label); sc.addUsage({ kind: 'model', provider: dec.providerId, model: dec.model, tokensIn: tin, tokensOut: tout, mayIncurCharge: dec.mayIncurCharge, label: dec.label }); });
    try { const r = await runAgent({ spec, planner, tools: d.tools, scope: sc, actor: { userId: c.s!.userId, role: c.s!.role }, goal, now }); return { ...r, models: [...new Set(decisions)] }; }
    catch (e) { if (e instanceof NoModelAvailable) throw new HttpError(503, e.message); throw e; }
  });

  route('GET', '/api/approvals', 'approval:read', (c) => [...scopeOf(c).approvals.values()].sort((a, b) => b.createdAt - a.createdAt));
  route('POST', '/api/approvals/:id/decision', 'approval:decide', async (c) => {
    const sc = scopeOf(c); const approve = c.body.approve === true;
    let ap; try { ap = sc.decideApproval(c.params.id!, { id: c.s!.userId, role: c.s!.role }, approve); } catch (e) { const m = (e as Error).message; bad(m, m === 'not_found' ? 404 : m === 'forbidden' ? 403 : 409); }
    ap = ap!;
    if (approve) {
      const p = ap.payload as { tool: string; args: Record<string, unknown> }; const tool = d.tools.get(p.tool);
      try { const out = (await tool!.run(p.args, { orgId: sc.orgId, agentId: ap.agentId })) as { executed?: boolean; note?: string };
        ap.execution = out?.executed === false ? 'no_connector' : 'executed'; ap.executionNote = out?.note; }
      catch (e) { ap.execution = 'failed'; ap.executionNote = (e as Error).message; }
      sc.record('system', 'approval.execution', ap.id, { execution: ap.execution });
    }
    return ap;
  });
  route('GET', '/api/autonomy', 'approval:read', (c) => scopeOf(c).autonomy ?? null);
  route('POST', '/api/autonomy', 'autonomy:grant', (c) => {
    const classes = (Array.isArray(c.body.actionClasses) ? c.body.actionClasses : []).filter((x: unknown) => x === 'outbound' || x === 'spend');
    const per = Number(c.body.maxSpendPerAction), tot = Number(c.body.maxSpendTotal), ttl = Number(c.body.ttlHours);
    if (!classes.length || ![per, tot, ttl].every((n) => Number.isFinite(n) && n >= 0) || ttl > 168 || ttl <= 0) bad('invalid grant');
    const sc = scopeOf(c); sc.autonomy = { id: randomBytes(8).toString('hex'), actionClasses: classes, maxSpendPerAction: per, maxSpendTotal: tot, spentSoFar: 0, expiresAt: now() + ttl * 3600_000, revoked: false, grantedBy: c.s!.userId };
    sc.record(`user:${c.s!.userId}`, 'autonomy.granted', sc.autonomy.id, { classes, per, tot, ttl }); return sc.autonomy;
  });
  route('DELETE', '/api/autonomy', 'autonomy:grant', (c) => { const sc = scopeOf(c); if (sc.autonomy) { sc.autonomy.revoked = true; sc.record(`user:${c.s!.userId}`, 'autonomy.revoked', sc.autonomy.id); } return { revoked: true }; });
  route('GET', '/api/audit', 'audit:read', (c) => ({ events: scopeOf(c).audit.slice(-200).reverse(), integrity: scopeOf(c).verifyAudit() }));
  route('GET', '/api/integrations', 'capability:read', (c) => CATALOG.map((x) => ({ ...x, health: d.connectors.health(scopeOf(c), x.id) })));
  route('POST', '/api/integrations/:id/grant', 'integration:manage', (c) => {
    const def = d.connectors.def(c.params.id!);
    if (def.status !== 'implemented') bad(`connector "${def.name}" is ${def.status}: it cannot be connected yet`, 501);
    const generated = def.auth === 'webhook_secret' && !c.body.secret ? randomBytes(32).toString('hex') : undefined;
    d.connectors.saveGrant(scopeOf(c), `user:${c.s!.userId}`, def.id, generated ?? str(c.body.secret, 'secret', 4096), Array.isArray(c.body.scopes) ? c.body.scopes : def.scopes);
    return generated ? { connected: true, webhookSecret: generated, note: 'shown once', url: `/webhooks/${c.s!.orgId}/${def.id}` } : { connected: true };
  });
  route('DELETE', '/api/integrations/:id/grant', 'integration:manage', (c) => ({ revoked: d.connectors.revoke(scopeOf(c), `user:${c.s!.userId}`, c.params.id!) }));
  route('GET', '/api/usage', 'usage:read', (c) => ({ summary: scopeOf(c).usageSummary(), recent: scopeOf(c).usage.slice(-50).reverse(), note: 'Local models and deterministic workflows are free. Paid-capable calls only occur with ALLOW_PAID_PROVIDERS=true and your own key.' }));
  route('GET', '/api/org/export', 'org:export', (c) => { scopeOf(c).record(`user:${c.s!.userId}`, 'org.export'); return scopeOf(c).export(); });
  route('POST', '/api/org/delete', 'org:delete', async (c) => {
    if (c.body.confirm !== 'DELETE') bad('confirm must be "DELETE"');
    if (!(await d.auth.reauth(c.s!.userId, str(c.body.password, 'password', 256)))) bad('re-authentication failed', 403);
    d.platform.deleteOrg(c.s!.orgId); return { deleted: true };
  });

  const server = http.createServer(async (req, res) => {
    const send = (status: number, body: unknown, extra: Record<string, string> = {}): void => { res.writeHead(status, { ...HEADERS, 'content-type': 'application/json', 'cache-control': 'no-store', ...extra }); res.end(JSON.stringify(body)); };
    try {
      const url = new URL(req.url ?? '/', 'http://x'); const method = req.method ?? 'GET';
      const st = method === 'GET' ? STATIC[url.pathname] : undefined;
      if (st) { res.writeHead(200, { ...HEADERS, 'content-type': st[1], 'cache-control': 'no-cache' }); return void res.end(readFileSync(PUB(st[0]))); }
      const chunks: Buffer[] = []; let size = 0;
      for await (const ch of req) { size += (ch as Buffer).length; if (size > MAX_BODY) return send(413, { error: 'payload too large' }); chunks.push(ch as Buffer); }
      const raw = Buffer.concat(chunks).toString('utf8');
      const wh = /^\/webhooks\/([^/]+)\/([^/]+)$/.exec(url.pathname);
      if (wh && method === 'POST') {
        const org = d.platform.orgs.get(wh[1]!);
        const r = org ? d.connectors.receiveWebhook(org.scope, wh[2]!, raw, req.headers['x-viralmind-signature'] as string | undefined, req.headers['x-viralmind-timestamp'] as string | undefined, now()) : { ok: false };
        return r.ok ? send(200, { ok: true }) : send(401, { error: 'rejected' });
      }
      for (const r of routes) {
        if (r.method !== method) continue; const m = r.re.exec(url.pathname); if (!m) continue;
        const token = /^Bearer (.+)$/.exec(String(req.headers.authorization ?? ''))?.[1];
        const c: Ctx = { req, res, raw, params: { ...m.groups }, q: url.searchParams, body: {}, token };
        if (method !== 'GET' && method !== 'DELETE' || raw) {
          if (method === 'POST' || raw) { if (!String(req.headers['content-type'] ?? '').includes('application/json')) return send(415, { error: 'content-type must be application/json' }); try { c.body = raw ? JSON.parse(raw) : {}; } catch { return send(400, { error: 'invalid JSON' }); } if (c.body === null || typeof c.body !== 'object') c.body = {}; }
        }
        if (r.perm !== 'public') {
          const s = d.auth.authenticate(token); if (!s) return send(401, { error: 'unauthenticated' });
          if (!apiLimiter.take(`s:${s.userId}`)) return send(429, { error: 'rate limited' }, { 'retry-after': '30' });
          if (r.perm !== 'authed' && !can(s.role, r.perm!)) { d.platform.scope(s.orgId).record(`user:${s.userId}`, 'authz.denied', `${method} ${url.pathname}`); return send(403, { error: 'forbidden' }); }
          c.s = s;
        }
        return send(200, await r.h(c));
      }
      send(404, { error: 'not found' });
    } catch (e) {
      if (e instanceof HttpError) return send(e.status, { error: e.message });
      log('error', 'unhandled', { err: (e as Error).message }); send(500, { error: 'internal error' });
    }
  });
  server.requestTimeout = 30_000; server.headersTimeout = 10_000;
  return server;
}
