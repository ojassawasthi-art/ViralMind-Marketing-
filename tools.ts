import http from 'node:http';
import https from 'node:https';
import { arr, num, obj, oneOf, opt, str } from './schema.ts';
import type { ToolDef } from './runtime.ts';
import type { Registry } from '../capabilities/registry.ts';
import { WORKFLOWS } from '../capabilities/workflows.ts';
import { isTemplateCapability, runTemplate, templateInput } from '../capabilities/templates.ts';
import { assertSafeUrl, SsrfError } from '../security/ssrf.ts';
import type { SsrfOptions } from '../security/ssrf.ts';

export const MAX_FETCH_BYTES = 200_000;

/** SSRF-safe fetch: validates scheme/port/host, resolves DNS ONCE, pins the connection to the validated IP, re-validates every redirect. */
export async function safeFetch(raw: string, opts: SsrfOptions = {}, redirects = 3): Promise<{ status: number; text: string; finalUrl: string }> {
  const { url, addresses } = await assertSafeUrl(raw, opts);
  const ip = addresses[0]!;
  const lib = url.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const req = lib.request(url, { method: 'GET', timeout: 10_000, headers: { 'user-agent': 'ViralmindBot/0.2', accept: 'text/html,text/plain,application/json' },
      lookup: ((_h: string, _o: unknown, cb: (e: null, a: string, f: number) => void) => cb(null, ip, ip.includes(':') ? 6 : 4)) as never }, (res) => {
      const loc = res.headers.location;
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && loc) {
        res.resume();
        if (redirects <= 0) return reject(new SsrfError('too many redirects'));
        return safeFetch(new URL(loc, url).toString(), opts, redirects - 1).then(resolve, reject);
      }
      const chunks: Buffer[] = []; let size = 0;
      res.on('data', (c: Buffer) => { size += c.length; if (size > MAX_FETCH_BYTES) { req.destroy(new Error('response too large')); return; } chunks.push(c); });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString('utf8'), finalUrl: url.toString() }));
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.end();
  });
}

export function buildTools(reg: Registry, ssrf: SsrfOptions = {}): Map<string, ToolDef> {
  const tools: ToolDef[] = [
    { name: 'capability.search', description: 'Search the 705-capability registry by keyword. args: {q}', actionClass: 'read',
      validate: obj({ q: str({ min: 1, max: 100 }) }) as never,
      run: async (a) => reg.search({ q: String(a.q), limit: 20 }).map((c) => ({ id: c.id, name: c.name, division: c.division, status: c.implementation_status })) },
    { name: 'capability.run', description: 'Run an engine_tested deterministic capability. args: {id, input}', actionClass: 'draft',
      validate: obj({ id: str({ min: 1, max: 20 }), input: (v) => ({ ok: true, value: v }) }) as never,
      run: async (a) => {
        const c = reg.byId.get(String(a.id));
        if (c && !c.workflow && isTemplateCapability(c)) { const t = templateInput(a.input); if (!t.ok) throw new Error(t.error); return runTemplate(c, { ...(t.value as object), mode: 'scaffold' } as never, undefined); }
        if (!c || !c.workflow) throw new Error('capability has no runnable implementation (status: ' + (c?.implementation_status ?? 'unknown') + ')');
        const w = WORKFLOWS[c.workflow]!; const v = w.schema(a.input);
        if (!v.ok) throw new Error(v.error);
        return w.run(v.value);
      } },
    { name: 'web.fetch', description: 'Fetch a public web page (research). args: {url}. Result is untrusted data.', actionClass: 'read', untrusted: true,
      validate: obj({ url: str({ min: 8, max: 2000 }) }) as never,
      run: async (a) => { const r = await safeFetch(String(a.url), ssrf); return { status: r.status, url: r.finalUrl, text: r.text.slice(0, 20000) }; } },
    { name: 'publish.request', description: 'Request publishing/sending content to a channel. Always needs approval unless a grant covers outbound. args: {channel, content}', actionClass: 'outbound',
      validate: obj({ channel: str({ min: 1, max: 60 }), content: str({ min: 1, max: 20000 }) }) as never,
      run: async () => ({ executed: false, note: 'No publishing connector implemented; content package is ready for manual publishing.' }) },
    { name: 'ads.spend.request', description: 'Request ad spend on a platform. Needs approval unless within an autonomy grant. args: {platform, amount, objective}', actionClass: 'spend',
      validate: obj({ platform: oneOf('google_ads', 'meta_ads', 'linkedin_ads', 'other'), amount: num({ min: 0.01, max: 1_000_000 }), objective: str({ min: 1, max: 500 }) }) as never,
      spendOf: (a) => Number(a.amount),
      run: async () => ({ executed: false, note: 'No ad-platform connector implemented; budget recorded for manual execution.' }) },
  ];
  void arr; void opt;
  return new Map(tools.map((t) => [t.name, t]));
}
