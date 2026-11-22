import type { CompleteRequest, CompleteResult, Provider } from './router.ts';

async function postJson(url: string, headers: Record<string, string>, body: unknown, signal?: AbortSignal): Promise<any> {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), signal: signal ?? AbortSignal.timeout(120_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`); // never include response body/headers: could echo secrets
  return res.json();
}

export class OllamaProvider implements Provider {
  id = 'ollama'; kind = 'local' as const; mayIncurCharge = false; defaultModel: string; base: string;
  constructor(base: string, model: string) { this.base = base.replace(/\/$/, ''); this.defaultModel = model; }
  async available(): Promise<boolean> {
    try { const r = await fetch(`${this.base}/api/tags`, { signal: AbortSignal.timeout(1500) }); return r.ok; } catch { return false; }
  }
  async complete(req: CompleteRequest): Promise<CompleteResult> {
    const j = await postJson(`${this.base}/api/chat`, {}, { model: req.model ?? this.defaultModel, messages: req.messages, stream: false, options: { num_predict: req.maxTokens ?? 1024 } }, req.signal);
    return { text: String(j.message?.content ?? ''), tokensIn: Number(j.prompt_eval_count ?? 0), tokensOut: Number(j.eval_count ?? 0) };
  }
}

/** OpenAI, xAI, NVIDIA NIM, Google (OpenAI-compat endpoint) and any compatible server. Key is fetched lazily from encrypted storage. */
export class OpenAICompatProvider implements Provider {
  id: string; kind: 'local' | 'user_key'; mayIncurCharge: boolean; defaultModel: string; base: string; getKey: () => string | undefined;
  constructor(o: { id: string; base: string; model: string; getKey: () => string | undefined; local?: boolean }) {
    this.id = o.id; this.base = o.base.replace(/\/$/, ''); this.defaultModel = o.model; this.getKey = o.getKey;
    this.kind = o.local ? 'local' : 'user_key'; this.mayIncurCharge = !o.local;
  }
  async available(): Promise<boolean> { return this.kind === 'local' || !!this.getKey(); }
  async complete(req: CompleteRequest): Promise<CompleteResult> {
    const key = this.getKey();
    const j = await postJson(`${this.base}/chat/completions`, key ? { authorization: `Bearer ${key}` } : {}, { model: req.model ?? this.defaultModel, messages: req.messages, max_tokens: req.maxTokens ?? 1024 }, req.signal);
    return { text: String(j.choices?.[0]?.message?.content ?? ''), tokensIn: Number(j.usage?.prompt_tokens ?? 0), tokensOut: Number(j.usage?.completion_tokens ?? 0) };
  }
}

export class AnthropicProvider implements Provider {
  id = 'anthropic'; kind = 'user_key' as const; mayIncurCharge = true; defaultModel: string; base: string; getKey: () => string | undefined;
  constructor(o: { base?: string; model: string; getKey: () => string | undefined }) { this.base = (o.base ?? 'https://api.anthropic.com').replace(/\/$/, ''); this.defaultModel = o.model; this.getKey = o.getKey; }
  async available(): Promise<boolean> { return !!this.getKey(); }
  async complete(req: CompleteRequest): Promise<CompleteResult> {
    const sys = req.messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n');
    const j = await postJson(`${this.base}/v1/messages`, { 'x-api-key': this.getKey() ?? '', 'anthropic-version': '2023-06-01' },
      { model: req.model ?? this.defaultModel, max_tokens: req.maxTokens ?? 1024, system: sys || undefined, messages: req.messages.filter((m) => m.role !== 'system') }, req.signal);
    return { text: String(j.content?.find((c: any) => c.type === 'text')?.text ?? ''), tokensIn: Number(j.usage?.input_tokens ?? 0), tokensOut: Number(j.usage?.output_tokens ?? 0) };
  }
}
