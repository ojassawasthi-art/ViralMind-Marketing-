import { createHmac, timingSafeEqual } from 'node:crypto';
import type { OrgScope } from '../core/store.ts';
import { decryptSecret, encryptSecret } from '../security/crypto.ts';
import { RateLimiter } from '../security/ratelimit.ts';

export type SupportStatus = 'implemented' | 'manual_workflow' | 'planned';
export interface ConnectorDef { id: string; name: string; auth: 'oauth2' | 'api_key' | 'webhook_secret'; scopes: string[]; officialApi: boolean; status: SupportStatus; notes: string }

/** Honest catalogue. Only `implemented` connectors actually move data. Everything else says what it is. */
export const CATALOG: ConnectorDef[] = [
  { id: 'webhook_inbound', name: 'Inbound webhooks (signed)', auth: 'webhook_secret', scopes: ['events:receive'], officialApi: true, status: 'implemented', notes: 'HMAC-SHA256 signature + timestamp replay window; events recorded in sync history.' },
  { id: 'meta', name: 'Meta (Facebook/Instagram) Graph API', auth: 'oauth2', scopes: ['pages_manage_posts', 'ads_management'], officialApi: true, status: 'planned', notes: 'Official Graph/Marketing API; requires Meta app review. Until built: manual publishing packages.' },
  { id: 'google', name: 'Google (Ads, Business Profile, Search Console, GA4)', auth: 'oauth2', scopes: ['adwords', 'webmasters.readonly', 'analytics.readonly'], officialApi: true, status: 'planned', notes: 'Official APIs; Ads needs developer token.' },
  { id: 'linkedin', name: 'LinkedIn Marketing API', auth: 'oauth2', scopes: ['w_member_social', 'r_ads'], officialApi: true, status: 'planned', notes: 'Partner-program gated. Prospecting by scraping is NOT supported (ToS).' },
  { id: 'whatsapp_business_platform', name: 'WhatsApp Business Platform', auth: 'api_key', scopes: ['messages'], officialApi: true, status: 'planned', notes: 'Template + opt-in rules apply; no unofficial clients.' },
  { id: 'email_provider', name: 'Email provider (SMTP / Brevo / Mailchimp)', auth: 'api_key', scopes: ['send'], officialApi: true, status: 'planned', notes: 'Consent + unsubscribe required before sending.' },
  { id: 'tiktok', name: 'TikTok (where available)', auth: 'oauth2', scopes: ['video.publish'], officialApi: true, status: 'planned', notes: 'Availability varies by region/app approval.' },
  { id: 'x_api', name: 'X API', auth: 'oauth2', scopes: ['tweet.write'], officialApi: true, status: 'planned', notes: 'Paid tiers for most write access; user supplies own credentials.' },
  { id: 'manual_csv', name: 'Manual export/import (CSV, copy-paste packages)', auth: 'api_key', scopes: [], officialApi: false, status: 'manual_workflow', notes: 'Transparent manual workflow where no official API exists or is not yet built.' },
];

export function verifyWebhook(secret: string, rawBody: string, signatureHex: string | undefined, timestampSec: string | undefined, nowMs: number, toleranceSec = 300): { ok: boolean; reason?: string } {
  const ts = Number(timestampSec);
  if (!signatureHex || !Number.isFinite(ts)) return { ok: false, reason: 'missing signature or timestamp' };
  if (Math.abs(nowMs / 1000 - ts) > toleranceSec) return { ok: false, reason: 'timestamp outside replay window' };
  const exp = createHmac('sha256', secret).update(`${ts}.${rawBody}`).digest();
  const got = Buffer.from(signatureHex, 'hex');
  return got.length === exp.length && timingSafeEqual(got, exp) ? { ok: true } : { ok: false, reason: 'bad signature' };
}
export const signWebhook = (secret: string, rawBody: string, ts: number): string => createHmac('sha256', secret).update(`${ts}.${rawBody}`).digest('hex');

export async function withRetry<T>(fn: (attempt: number) => Promise<T>, o: { retries: number; baseMs: number; retryable?: (e: unknown) => boolean; sleep?: (ms: number) => Promise<void> }): Promise<T> {
  const sleep = o.sleep ?? ((ms) => new Promise<void>((r) => setTimeout(r, ms)));
  for (let a = 0; ; a++) {
    try { return await fn(a); } catch (e) {
      if (a >= o.retries || (o.retryable && !o.retryable(e))) throw e;
      await sleep(o.baseMs * 2 ** a + Math.floor(Math.random() * o.baseMs));
    }
  }
}

export class ConnectorManager {
  key: Buffer; limiter = new RateLimiter(120, 2);
  constructor(key: Buffer) { this.key = key; }
  def(id: string): ConnectorDef { const d = CATALOG.find((c) => c.id === id); if (!d) throw new Error('unknown_connector'); return d; }
  saveGrant(scope: OrgScope, actor: string, connectorId: string, secret: string, scopes: string[]): void {
    const d = this.def(connectorId);
    scope.grants.set(connectorId, { connectorId, secretEnc: encryptSecret(this.key, secret, `${scope.orgId}:${connectorId}`), scopes: scopes.filter((s) => d.scopes.includes(s)), createdAt: Date.now() });
    scope.record(actor, 'connector.grant_saved', connectorId, { scopes });
  }
  getSecret(scope: OrgScope, connectorId: string): string | undefined {
    const g = scope.grants.get(connectorId);
    return g && !g.revokedAt ? decryptSecret(this.key, g.secretEnc, `${scope.orgId}:${connectorId}`) : undefined;
  }
  revoke(scope: OrgScope, actor: string, connectorId: string): boolean {
    const g = scope.grants.get(connectorId); if (!g || g.revokedAt) return false;
    g.revokedAt = Date.now(); g.secretEnc = ''; scope.record(actor, 'connector.revoked', connectorId); return true;
  }
  health(scope: OrgScope, connectorId: string): { connectorId: string; status: SupportStatus; connected: boolean; lastSync?: number; note: string } {
    const d = this.def(connectorId); const g = scope.grants.get(connectorId);
    const last = [...scope.sync].reverse().find((s) => s.connectorId === connectorId);
    return { connectorId, status: d.status, connected: !!g && !g.revokedAt, lastSync: last?.ts, note: d.status === 'implemented' ? 'operational' : 'not operational: ' + d.notes };
  }
  receiveWebhook(scope: OrgScope, connectorId: string, rawBody: string, sig: string | undefined, ts: string | undefined, nowMs: number): { ok: boolean; reason?: string } {
    if (!this.limiter.take(`${scope.orgId}:${connectorId}`)) return { ok: false, reason: 'rate limited' };
    const secret = this.getSecret(scope, connectorId);
    const log = (status: 'ok' | 'rejected', detail: string): void => { scope.sync.push({ ts: nowMs, connectorId, direction: 'inbound', status, detail }); };
    if (!secret) { log('rejected', 'connector not configured'); return { ok: false, reason: 'not configured' }; }
    const v = verifyWebhook(secret, rawBody, sig, ts, nowMs);
    if (!v.ok) { log('rejected', v.reason ?? 'invalid'); return v; }
    if (sig) { // replay: reject exact signature seen inside the window
      if (scope.nonces.has(sig)) { log('rejected', 'replayed signature'); return { ok: false, reason: 'replayed' }; }
      scope.nonces.set(sig, nowMs);
      for (const [k, t] of scope.nonces) if (nowMs - t > 600_000) scope.nonces.delete(k);
    }
    log('ok', `received ${rawBody.length} bytes`);
    return { ok: true };
  }
}
