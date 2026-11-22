'use strict';
// No innerHTML anywhere: all dynamic text goes through textContent (XSS defence; CSP also forbids inline script).
const $app = document.getElementById('app');
let token = sessionStorage.getItem('vm_token'), me = null;
const h = (tag, attrs, ...kids) => { const e = document.createElement(tag); for (const [k, v] of Object.entries(attrs || {})) { if (k === 'on') for (const [ev, fn] of Object.entries(v)) e.addEventListener(ev, fn); else if (k === 'class') e.className = v; else e.setAttribute(k, v); } for (const kid of kids.flat()) if (kid != null) e.append(kid.nodeType ? kid : document.createTextNode(String(kid))); return e; };
async function api(method, path, body) {
  const r = await fetch(path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401 && token && path !== '/api/auth/login') { token = null; sessionStorage.removeItem('vm_token'); render(); }
  if (!r.ok) throw Object.assign(new Error(j.error || r.statusText), { status: r.status });
  return j;
}
const tag = (t, cls = '') => h('span', { class: 'tag ' + cls }, t);
const statusTag = (s) => tag(s, s === 'engine_tested' ? 't-ok' : 't-warn');
const pre = (o) => h('pre', {}, typeof o === 'string' ? o : JSON.stringify(o, null, 2));
const msg = (e) => h('div', { class: 'err' }, e.message);
const NAV = [['command', 'Command Centre'], ['divisions', 'Divisions'], ['agents', 'Agent Centre'], ['approvals', 'Approval Centre'], ['integrations', 'Integrations'], ['security', 'Security & Permissions'], ['settings', 'Settings & Usage'], ['workspaces', 'Other workspaces']];

function loginView() {
  const out = h('div'); const f = (id, type, ph) => h('input', { id, type, placeholder: ph, autocomplete: 'off' });
  const email = f('e', 'email', 'Email'), pw = f('p', 'password', 'Password (12+ chars)'), org = f('o', 'text', 'Organization name (register only)'), totp = f('t', 'text', 'MFA code (if enabled)');
  const go = async (path) => { out.replaceChildren(); try {
    if (path === 'register') await api('POST', '/api/auth/register', { email: email.value, password: pw.value, orgName: org.value });
    const r = await api('POST', '/api/auth/login', { email: email.value, password: pw.value, totp: totp.value || undefined });
    token = r.token; sessionStorage.setItem('vm_token', token); location.hash = '#command'; render(); } catch (e) { out.append(msg(e)); } };
  return h('div', { class: 'login card' }, h('h2', {}, 'VIRALMIND AI'), h('p', { class: 'mut' }, 'Self-hosted. Local-AI-first. Nothing runs or spends without your approval.'),
    h('div', { class: 'grid', style: 'grid-template-columns:1fr' }, email, pw, org, totp, h('div', { class: 'row' }, h('button', { on: { click: () => go('login') } }, 'Sign in'), h('button', { class: 'ghost', on: { click: () => go('register') } }, 'Register + sign in'))), out);
}

const views = {
  async command() {
    const [divs, ap, models, usage] = await Promise.all([api('GET', '/api/divisions'), api('GET', '/api/approvals'), api('GET', '/api/models/status'), api('GET', '/api/usage')]);
    const total = divs.reduce((a, d) => a + d.total, 0), eng = divs.reduce((a, d) => a + (d.byStatus.engine_tested || 0), 0), tpl = divs.reduce((a, d) => a + (d.byStatus.template_runnable || 0), 0);
    const stat = (n, l) => h('div', { class: 'card' }, h('div', { class: 'big' }, n), h('div', { class: 'mut' }, l));
    return h('div', {}, h('h2', {}, 'Command Centre'), h('div', { class: 'grid' }, stat(total, 'capabilities in registry'), stat(eng, 'deterministic & tested'), stat(tpl, 'template-runnable (draft/scaffold; quality unverified)'), stat(total - eng - tpl, 'not implemented (tool references)'), stat(ap.filter((a) => a.status === 'pending').length, 'pending approvals'), stat(usage.summary.calls, 'model/capability calls')),
      h('div', { class: 'card' }, h('b', {}, 'AI providers'), models.providers.map((p) => h('div', {}, p.id, ' ', tag(p.available ? 'available' : 'unavailable', p.available ? 't-ok' : 't-warn'), p.mayIncurCharge ? tag(p.blockedByPolicy ? 'paid: blocked by policy' : 'may incur charge', 't-bad') : tag('local, free', 't-ok')))));
  },
  async divisions(arg) {
    if (!arg) { const divs = await api('GET', '/api/divisions'); return h('div', {}, h('h2', {}, 'Divisions'), h('div', { class: 'grid' }, divs.map((d) => h('a', { class: 'card', href: '#divisions/' + encodeURIComponent(d.division) }, h('b', {}, d.division), h('div', { class: 'mut' }, d.total + ' capabilities'), tag((d.byStatus.engine_tested || 0) + ' tested', 't-ok'), tag((d.byStatus.template_runnable || 0) + ' template', 't-warn'))))); }
    const div = decodeURIComponent(arg), list = h('div'), q = h('input', { placeholder: 'Filter…' });
    const load = async () => { const caps = await api('GET', '/api/capabilities?division=' + encodeURIComponent(div) + '&q=' + encodeURIComponent(q.value));
      list.replaceChildren(...caps.map((c) => { const out = h('div'); return h('div', { class: 'card' }, h('div', { class: 'row' }, h('b', {}, c.id + ' · ' + c.name), statusTag(c.status), tag(c.execution_mode), tag(c.cost_class), c.approval_required.map((a) => tag(a, 't-bad'))),
        c.runnable ? h('button', { on: { click: () => runForm(c.id, out) } }, 'Run') : h('span', { class: 'mut' }, c.kind === 'tool' ? 'Integration reference (not a runnable action)' : 'Unavailable: not implemented yet'), out); })); };
    q.addEventListener('input', load); await load();
    return h('div', {}, h('a', { href: '#divisions' }, '← Divisions'), h('h2', {}, div), q, list);
  },
  async agents() {
    const agents = await api('GET', '/api/agents'), out = h('div'), goal = h('textarea', { placeholder: 'Describe the goal, e.g. “Plan a content calendar and budget for a December launch”' }), sel = h('select', {}, agents.map((a) => h('option', { value: a.id }, a.name)));
    return h('div', {}, h('h2', {}, 'Agent Centre'), h('div', { class: 'card' }, goal, h('div', { class: 'row' }, sel,
      h('button', { on: { click: async () => { out.replaceChildren('Running…'); try { out.replaceChildren(pre(await api('POST', '/api/agents/' + encodeURIComponent(sel.value) + '/run', { goal: goal.value }))); } catch (e) { out.replaceChildren(msg(e)); } } } }, 'Run agent'),
      h('button', { class: 'ghost', on: { click: async () => { try { out.replaceChildren(pre(await api('POST', '/api/chief/route', { goal: goal.value }))); } catch (e) { out.replaceChildren(msg(e)); } } } }, 'Route (no model)')), out),
      h('p', { class: 'mut' }, 'Agents need a local model (Ollama) or an explicitly allowed user-owned API key. Without one, deterministic capabilities in Divisions still run.'),
      agents.map((a) => h('div', { class: 'card' }, h('b', {}, a.name), ' ', tag(a.role), a.tools.map((t) => tag(t)))));
  },
  async approvals() {
    const list = await api('GET', '/api/approvals'), out = h('div');
    const decide = async (id, approve) => { try { await api('POST', '/api/approvals/' + id + '/decision', { approve }); render(); } catch (e) { out.replaceChildren(msg(e)); } };
    return h('div', {}, h('h2', {}, 'Approval Centre'), out, list.length ? list.map((a) => h('div', { class: 'card' }, h('div', { class: 'row' }, h('b', {}, a.summary), tag(a.actionClass, 't-bad'), tag(a.status, a.status === 'pending' ? 't-warn' : 't-ok'), a.spend != null ? tag('spend ' + a.spend) : null, a.status === 'approved' ? tag(a.execution) : null),
      pre(a.payload), a.executionNote ? h('div', { class: 'mut' }, a.executionNote) : null,
      a.status === 'pending' ? h('div', { class: 'row' }, h('button', { on: { click: () => decide(a.id, true) } }, 'Approve'), h('button', { class: 'bad', on: { click: () => decide(a.id, false) } }, 'Reject')) : null)) : h('p', { class: 'mut' }, 'No approvals yet.'));
  },
  async integrations() {
    const list = await api('GET', '/api/integrations'), out = h('div');
    return h('div', {}, h('h2', {}, 'Integration Manager'), out, list.map((c) => h('div', { class: 'card' }, h('div', { class: 'row' }, h('b', {}, c.name), tag(c.status, c.status === 'implemented' ? 't-ok' : 't-warn'), tag(c.auth), c.officialApi ? tag('official API') : tag('manual workflow'), c.health.connected ? tag('connected', 't-ok') : null),
      h('div', { class: 'mut' }, c.notes),
      c.status === 'implemented' ? h('div', { class: 'row' }, h('button', { on: { click: async () => { try { const r = await api('POST', '/api/integrations/' + c.id + '/grant', {}); out.replaceChildren(h('div', { class: 'card' }, 'Webhook secret (shown once): ', pre(r.webhookSecret), 'POST signed events to ' + location.origin + r.url)); } catch (e) { out.replaceChildren(msg(e)); } } } }, 'Generate secret'),
        h('button', { class: 'ghost', on: { click: async () => { await api('DELETE', '/api/integrations/' + c.id + '/grant'); render(); } } }, 'Revoke')) : h('span', { class: 'mut' }, 'Unavailable: cannot be connected yet'))));
  },
  async security() {
    const [a, meInfo] = await Promise.all([api('GET', '/api/audit').catch((e) => ({ error: e })), api('GET', '/api/me')]), out = h('div'), code = h('input', { placeholder: 'MFA code' });
    const grant = h('div', { class: 'card' }, h('b', {}, 'Autonomy grant (owner only)'), h('p', { class: 'mut' }, 'Allows agents to send/spend without per-action approval, within limits. Deleting data and changing critical settings always need approval.'));
    const per = h('input', { placeholder: 'Max spend per action', type: 'number' }), tot = h('input', { placeholder: 'Max total spend', type: 'number' }), ttl = h('input', { placeholder: 'Expires in hours (max 168)', type: 'number' });
    grant.append(per, tot, ttl, h('div', { class: 'row' }, h('button', { on: { click: async () => { try { out.replaceChildren(pre(await api('POST', '/api/autonomy', { actionClasses: ['outbound', 'spend'], maxSpendPerAction: +per.value, maxSpendTotal: +tot.value, ttlHours: +ttl.value }))); } catch (e) { out.replaceChildren(msg(e)); } } } }, 'Grant'), h('button', { class: 'ghost', on: { click: async () => { try { await api('DELETE', '/api/autonomy'); out.replaceChildren('Revoked'); } catch (e) { out.replaceChildren(msg(e)); } } } }, 'Revoke')));
    return h('div', {}, h('h2', {}, 'Security & Permissions'), h('div', { class: 'card' }, 'Signed in as ', meInfo.email, ' · role ', tag(meInfo.role), ' · MFA ', tag(meInfo.mfaEnabled ? 'enabled' : 'off', meInfo.mfaEnabled ? 't-ok' : 't-warn')),
      h('div', { class: 'card' }, h('b', {}, 'MFA (TOTP)'), h('div', { class: 'row' }, h('button', { on: { click: async () => { try { const r = await api('POST', '/api/auth/mfa/enroll'); out.replaceChildren(h('div', {}, 'Add this secret to an authenticator app, then confirm with a code:', pre(r.secretBase32 + '\n' + r.otpauthUri))); } catch (e) { out.replaceChildren(msg(e)); } } } }, 'Enroll'), code,
        h('button', { class: 'ghost', on: { click: async () => { try { await api('POST', '/api/auth/mfa/confirm', { code: code.value }); render(); } catch (e) { out.replaceChildren(msg(e)); } } } }, 'Confirm'))), out, grant,
      h('div', { class: 'card' }, h('b', {}, 'Audit log '), a.integrity ? tag(a.integrity.ok ? 'hash chain intact' : 'TAMPERED at ' + a.integrity.brokenAt, a.integrity.ok ? 't-ok' : 't-bad') : tag('no access', 't-warn'),
        (a.events || []).slice(0, 40).map((e) => h('div', { class: 'mut' }, new Date(e.ts).toISOString() + ' · ' + e.actor + ' · ' + e.action + (e.target ? ' · ' + e.target : '')))));
  },
  async settings() {
    const [m, u] = await Promise.all([api('GET', '/api/models/status'), api('GET', '/api/usage')]), out = h('div'), pw = h('input', { type: 'password', placeholder: 'Password to confirm deletion' });
    return h('div', {}, h('h2', {}, 'Settings & Usage'), h('div', { class: 'card' }, h('b', {}, 'Model policy'), pre(m.policy), h('p', { class: 'mut' }, 'Paid providers are used only if ALLOW_PAID_PROVIDERS=true is set by the host AND a key is configured. Every call is logged with the model used and whether it can incur a charge.')),
      h('div', { class: 'card' }, h('b', {}, 'Usage'), pre(u.summary), h('div', { class: 'mut' }, u.note)),
      h('div', { class: 'card' }, h('b', {}, 'Data export & deletion'), h('div', { class: 'row' }, h('button', { on: { click: async () => { try { const j = await api('GET', '/api/org/export'); const a = h('a', { href: URL.createObjectURL(new Blob([JSON.stringify(j, null, 2)], { type: 'application/json' })), download: 'viralmind-export.json' }); document.body.append(a); a.click(); a.remove(); } catch (e) { out.replaceChildren(msg(e)); } } } }, 'Export data'), pw,
        h('button', { class: 'bad', on: { click: async () => { try { await api('POST', '/api/org/delete', { confirm: 'DELETE', password: pw.value }); token = null; sessionStorage.removeItem('vm_token'); render(); } catch (e) { out.replaceChildren(msg(e)); } } } }, 'Delete organization')), out));
  },
  async workspaces() {
    const items = ['Research viewer', 'Brand memory', 'Content studio', 'Creative library', 'Campaign manager', 'Automation builder', 'Analytics dashboards', 'Agency client portal'];
    return h('div', {}, h('h2', {}, 'Other workspaces'), h('p', { class: 'mut' }, 'These screens are part of the product plan but are not built yet. They are listed here so nothing pretends to work.'), items.map((i) => h('div', { class: 'card' }, h('b', {}, i), ' ', tag('unavailable: not built', 't-warn'))));
  },
};

const templateView = (r) => h('div', {}, h('div', { class: 'row' }, tag(r.mode === 'model' ? 'model draft: ' + r.model.label : 'scaffold (no model used)', r.mode === 'model' ? 't-ok' : 't-warn'), tag(r.cost), r.humanExecutionRequired ? tag('humans execute', 't-bad') : null), h('p', { class: 'mut' }, r.caveat), r.warnings.map((w) => h('div', { class: 'err' }, w)), r.sections.map((x) => h('div', { class: 'card' }, h('b', {}, x.name), h('div', {}, x.content || x.guidance))), r.requiresApprovalToExecute.length ? h('p', { class: 'mut' }, 'Executing this for real requires: ' + r.requiresApprovalToExecute.join(', ')) : null);
async function runForm(id, out) {
  const c = await api('GET', '/api/capabilities/' + id), ta = h('textarea', {}); ta.value = JSON.stringify(c.inputExample ?? {}, null, 2);
  out.replaceChildren(ta, h('div', { class: 'row' }, h('button', { on: { click: async () => { try { out.lastChild.nextSibling?.remove(); const r = await api('POST', '/api/capabilities/' + id + '/run', { input: JSON.parse(ta.value) }); out.append(r.sections ? templateView(r) : pre(r)); } catch (e) { out.append(msg(e)); } } } }, 'Execute (free scaffold / your local model)')));
}

async function render() {
  if (!token) return $app.replaceChildren(loginView());
  const [page, arg] = (location.hash.slice(1) || 'command').split('/'); const view = views[page] || views.command;
  const main = h('main', {}, 'Loading…');
  $app.replaceChildren(h('nav', {}, h('h1', {}, 'VIRALMIND'), NAV.map(([k, l]) => h('a', { href: '#' + k, class: k === page ? 'on' : '' }, l)), h('a', { href: '#', on: { click: async (e) => { e.preventDefault(); try { await api('POST', '/api/auth/logout'); } catch {} token = null; sessionStorage.removeItem('vm_token'); render(); } } }, 'Sign out')), main);
  try { main.replaceChildren(await view(arg)); } catch (e) { main.replaceChildren(msg(e)); }
}
addEventListener('hashchange', render); render();
