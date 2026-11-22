import type { AgentSpec } from './runtime.ts';
import { any, obj, str, arr } from './schema.ts';

export const DIVISIONS = ['Intelligence Hub', 'Brand Studio', 'Strategy HQ', 'Social Command', 'Content Factory', 'Creative Lab', 'Advertising HQ', 'Search Engine Lab',
  'Web Studio', 'Growth Engine', 'Communication Hub', 'Automation Lab', 'Influence & PR', 'Data Intelligence', 'Agency Command'] as const;

const DEFAULT_BUDGET = { maxSteps: 6, maxTokens: 20_000, maxMillis: 120_000, maxSpend: 0 };
const OUT = obj({ summary: str({ min: 1, max: 8000 }), findings: arr(str({ max: 2000 }), { max: 50 }) });

export function buildAgents(): AgentSpec[] {
  const directors: AgentSpec[] = DIVISIONS.map((d) => ({
    id: `director:${d.toLowerCase().replace(/[^a-z]+/g, '-')}`, name: `${d} Director`, role: 'director', division: d,
    tools: ['capability.search', 'capability.run', 'web.fetch', 'publish.request', 'ads.spend.request'].filter((t) => d === 'Advertising HQ' || t !== 'ads.spend.request'),
    budget: { ...DEFAULT_BUDGET, maxSpend: d === 'Advertising HQ' ? 1000 : 0 }, outputSchema: OUT as never,
    systemPrompt: `You are the ${d} Director of VIRALMIND AI. Plan and draft work for your division. You cannot publish, send or spend without approval. Return {"final":{"summary":"...","findings":["..."]}}.`,
  }));
  const chief: AgentSpec = { id: 'chief-orchestrator', name: 'Chief Orchestrator', role: 'chief', tools: ['capability.search'], budget: { ...DEFAULT_BUDGET, maxSteps: 3 }, outputSchema: any() as never,
    systemPrompt: 'You route goals to the right division director. Deterministic keyword routing is used when no model is available.' };
  return [chief, ...directors];
}
