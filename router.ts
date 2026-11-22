export interface ChatMessage { role: 'system' | 'user' | 'assistant'; content: string }
export interface CompleteRequest { messages: ChatMessage[]; maxTokens?: number; model?: string; signal?: AbortSignal }
export interface CompleteResult { text: string; tokensIn: number; tokensOut: number }

export interface Provider {
  id: string;
  kind: 'local' | 'user_key';
  /** true when a call to this provider can cost the key owner money */
  mayIncurCharge: boolean;
  defaultModel: string;
  available(): Promise<boolean>;
  complete(req: CompleteRequest): Promise<CompleteResult>;
}
export interface RoutePolicy { allowPaid: boolean; order?: string[] }
export interface RouteDecision { providerId: string; model: string; mayIncurCharge: boolean; label: string; fallbackUsed: boolean }

export class NoModelAvailable extends Error {}

/** Provider-independent router. Order: local first; user-key (potentially paid) providers are used ONLY when the policy
 *  explicitly allows paid use. Every decision carries `mayIncurCharge` so the UI/audit can show it. Never silently paid. */
export class ModelRouter {
  providers: Provider[]; policy: RoutePolicy;
  constructor(providers: Provider[], policy: RoutePolicy) { this.providers = providers; this.policy = policy; }

  private candidates(): Provider[] {
    const order = this.policy.order;
    const eligible = this.providers.filter((p) => p.kind === 'local' || (this.policy.allowPaid && p.mayIncurCharge) || (!p.mayIncurCharge));
    const rank = (p: Provider): number => (order && order.includes(p.id) ? order.indexOf(p.id) : 100) + (p.kind === 'local' ? 0 : 1000);
    return [...eligible].sort((a, b) => rank(a) - rank(b));
  }
  async status(): Promise<{ id: string; kind: string; available: boolean; mayIncurCharge: boolean; blockedByPolicy: boolean; model: string }[]> {
    return Promise.all(this.providers.map(async (p) => ({ id: p.id, kind: p.kind, available: await p.available().catch(() => false), mayIncurCharge: p.mayIncurCharge,
      blockedByPolicy: p.mayIncurCharge && !this.policy.allowPaid, model: p.defaultModel })));
  }
  async complete(req: CompleteRequest): Promise<CompleteResult & { decision: RouteDecision }> {
    let first = true; const errors: string[] = [];
    for (const p of this.candidates()) {
      if (!(await p.available().catch(() => false))) { errors.push(`${p.id}: unavailable`); first = false; continue; }
      try {
        const model = req.model ?? p.defaultModel;
        const out = await p.complete({ ...req, model });
        return { ...out, decision: { providerId: p.id, model, mayIncurCharge: p.mayIncurCharge, fallbackUsed: !first,
          label: `${p.id}/${model}${p.mayIncurCharge ? ' (may incur charge on your API key)' : ' (local, no charge)'}` } };
      } catch (e) { errors.push(`${p.id}: ${(e as Error).message}`); first = false; }
    }
    throw new NoModelAvailable(`no eligible model provider available (${errors.join('; ') || 'none configured'}). Deterministic workflows still work.`);
  }
}
