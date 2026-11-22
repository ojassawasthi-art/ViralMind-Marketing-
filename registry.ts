import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export type ImplStatus = 'not_implemented' | 'engine_tested' | 'template_runnable' | 'implemented_tested';
export interface Capability {
  id: string; ordinal: number; name: string; kind: 'capability' | 'tool'; department_number: number; department: string; tool_group: string | null;
  division: string; execution_mode: string; cost_class: string; required_permissions: string[]; approval_required: string[];
  required_integrations: string[]; model_requirements: string; inputs: string[]; outputs: string[];
  archetype?: string; implementation_status: ImplStatus; test_refs: string[]; workflow?: string; description: string | null;
}
export class Registry {
  all: Capability[]; byId: Map<string, Capability>;
  constructor(all: Capability[]) { this.all = all; this.byId = new Map(all.map((c) => [c.id, c])); }
  static load(path = fileURLToPath(new URL('../../registry/capabilities.json', import.meta.url))): Registry {
    const d = JSON.parse(readFileSync(path, 'utf8')) as { count: number; capabilities: Capability[] };
    if (d.count !== 705 || d.capabilities.length !== 705) throw new Error(`registry must contain exactly 705 entries, found ${d.capabilities.length}`);
    return new Registry(d.capabilities);
  }
  divisions(): { division: string; total: number; byStatus: Record<string, number> }[] {
    const m = new Map<string, { division: string; total: number; byStatus: Record<string, number> }>();
    for (const c of this.all) {
      const d = m.get(c.division) ?? { division: c.division, total: 0, byStatus: {} };
      d.total++; d.byStatus[c.implementation_status] = (d.byStatus[c.implementation_status] ?? 0) + 1; m.set(c.division, d);
    }
    return [...m.values()];
  }
  search(o: { division?: string; q?: string; status?: string; limit?: number } = {}): Capability[] {
    const q = o.q?.toLowerCase();
    return this.all.filter((c) => (!o.division || c.division === o.division) && (!o.status || c.implementation_status === o.status) && (!q || c.name.toLowerCase().includes(q))).slice(0, o.limit ?? 800);
  }
  /** Deterministic chief-orchestrator routing (no model needed): score divisions by keyword overlap with capability names. */
  routeDivision(goal: string): { division: string; score: number }[] {
    const words = new Set(goal.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []);
    const score = new Map<string, number>();
    for (const c of this.all) for (const w of c.name.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []) if (words.has(w)) score.set(c.division, (score.get(c.division) ?? 0) + 1);
    return [...score].map(([division, s]) => ({ division, score: s })).sort((a, b) => b.score - a.score);
  }
}
