import { arr, bool, num, obj, oneOf, opt, str } from '../ai/schema.ts';
import type { Schema } from '../ai/schema.ts';
import { MORE, MORE_EXAMPLES } from './workflows2.ts';

/** Deterministic, model-free implementations (zero cost, fully testable). Keyed by registry/implementation.json "workflow". */
export interface Workflow { schema: Schema<any>; run: (i: any) => unknown }
const r2 = (n: number): number => Math.round(n * 100) / 100;

function normCdf(z: number): number { // Abramowitz–Stegun 7.1.26 erf approximation (|err| < 1.5e-7)
  const x = Math.abs(z) / Math.SQRT2, t = 1 / (1 + 0.3275911 * x);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return 0.5 * (1 + (z < 0 ? -y : y));
}

export const WORKFLOWS: Record<string, Workflow> = {
  roas: {
    schema: obj({ revenue: num({ min: 0 }), adSpend: num({ min: 0.01 }) }),
    run: ({ revenue, adSpend }) => ({ roas: r2(revenue / adSpend), profitableAtBreakeven: revenue >= adSpend, note: 'Revenue-based ROAS; ignores margin. Compare against gross margin before scaling spend.' }),
  },
  cac: {
    schema: obj({ totalSalesMarketingSpend: num({ min: 0 }), newCustomers: num({ min: 1, int: true }) }),
    run: ({ totalSalesMarketingSpend, newCustomers }) => ({ cac: r2(totalSalesMarketingSpend / newCustomers) }),
  },
  clv: {
    schema: obj({ avgOrderValue: num({ min: 0 }), purchasesPerYear: num({ min: 0 }), lifespanYears: num({ min: 0, max: 100 }), grossMarginPct: num({ min: 0, max: 100 }), cac: opt(num({ min: 0.01 })) }),
    run: ({ avgOrderValue, purchasesPerYear, lifespanYears, grossMarginPct, cac }) => {
      const clv = avgOrderValue * purchasesPerYear * lifespanYears * (grossMarginPct / 100);
      return { clv: r2(clv), ltvToCac: cac ? r2(clv / cac) : null, note: 'Simple undiscounted margin-based CLV. Rule of thumb: LTV:CAC >= 3 is healthy.' };
    },
  },
  title_tag: {
    schema: obj({ title: str({ min: 1, max: 300 }), keyword: opt(str({ max: 100 })) }),
    run: ({ title, keyword }) => {
      const issues: string[] = [];
      if (title.length < 30) issues.push('Shorter than 30 characters: may under-use available space.');
      if (title.length > 60) issues.push('Longer than ~60 characters: likely truncated in results (character heuristic, not pixel width).');
      if (keyword) { const i = title.toLowerCase().indexOf(keyword.toLowerCase()); if (i < 0) issues.push('Target keyword missing.'); else if (i > 30) issues.push('Keyword appears late; consider moving it forward.'); }
      return { length: title.length, ok: issues.length === 0, issues };
    },
  },
  meta_description: {
    schema: obj({ text: str({ min: 1, max: 600 }), keyword: opt(str({ max: 100 })) }),
    run: ({ text, keyword }) => {
      const issues: string[] = [];
      if (text.length < 70) issues.push('Shorter than 70 characters.');
      if (text.length > 160) issues.push('Longer than ~160 characters: likely truncated.');
      if (keyword && !text.toLowerCase().includes(keyword.toLowerCase())) issues.push('Target keyword missing.');
      return { length: text.length, ok: issues.length === 0, issues };
    },
  },
  conversion_test: {
    schema: obj({ visitorsA: num({ min: 1, int: true }), conversionsA: num({ min: 0, int: true }), visitorsB: num({ min: 1, int: true }), conversionsB: num({ min: 0, int: true }) }),
    run: ({ visitorsA, conversionsA, visitorsB, conversionsB }) => {
      if (conversionsA > visitorsA || conversionsB > visitorsB) throw new Error('conversions cannot exceed visitors');
      const pA = conversionsA / visitorsA, pB = conversionsB / visitorsB, p = (conversionsA + conversionsB) / (visitorsA + visitorsB);
      const se = Math.sqrt(p * (1 - p) * (1 / visitorsA + 1 / visitorsB));
      const z = se === 0 ? 0 : (pB - pA) / se, pValue = 2 * (1 - normCdf(Math.abs(z)));
      return { rateA: r2(pA * 100), rateB: r2(pB * 100), relativeLiftPct: pA === 0 ? null : r2(((pB - pA) / pA) * 100), z: r2(z), pValue: Math.round(pValue * 10000) / 10000,
        significantAt95: pValue < 0.05, caution: Math.min(visitorsA, visitorsB) < 1000 ? 'Small sample: treat as directional only.' : undefined };
    },
  },
  lead_score: {
    schema: obj({ businessEmail: bool(), pageViews: num({ min: 0, int: true }), requestedDemo: bool(), budgetConfirmed: bool(), companySize: num({ min: 0, int: true }), daysSinceLastActivity: num({ min: 0 }) }),
    run: (l) => {
      const parts = { businessEmail: l.businessEmail ? 10 : 0, engagement: Math.min(l.pageViews, 10) * 2, demo: l.requestedDemo ? 30 : 0, budget: l.budgetConfirmed ? 20 : 0,
        size: l.companySize >= 200 ? 10 : l.companySize >= 20 ? 5 : 0, recency: l.daysSinceLastActivity <= 7 ? 10 : l.daysSinceLastActivity <= 30 ? 5 : 0 };
      const score = Object.values(parts).reduce((a, b) => a + b, 0);
      return { score, grade: score >= 70 ? 'hot' : score >= 40 ? 'warm' : 'cold', breakdown: parts, note: 'Transparent rule-based scoring; tune weights to your own conversion data.' };
    },
  },
  budget_plan: {
    schema: obj({ total: num({ min: 0 }), reservePct: num({ min: 0, max: 50 }), channels: arr(obj({ name: str({ min: 1, max: 80 }), weight: num({ min: 0 }) }), { min: 1, max: 30 }) }),
    run: ({ total, reservePct, channels }) => {
      const cents = Math.round(total * 100), reserve = Math.round(cents * reservePct / 100), pool = cents - reserve;
      const w = channels.reduce((a: number, c: any) => a + c.weight, 0);
      if (w <= 0) throw new Error('at least one channel weight must be > 0');
      const raw = channels.map((c: any) => (pool * c.weight) / w), base = raw.map(Math.floor);
      let left = pool - base.reduce((a: number, b: number) => a + b, 0);
      raw.map((x: number, i: number) => ({ i, f: x - Math.floor(x) })).sort((a: any, b: any) => b.f - a.f).forEach(({ i }: any) => { if (left > 0) { base[i]++; left--; } });
      return { reserve: reserve / 100, allocations: channels.map((c: any, i: number) => ({ channel: c.name, amount: base[i] / 100 })), allocated: (pool - left) / 100 };
    },
  },
  content_calendar: {
    schema: obj({ startDate: str({ min: 10, max: 10 }), weeks: num({ min: 1, max: 26, int: true }), channels: arr(obj({ name: str({ min: 1, max: 60 }), postsPerWeek: num({ min: 1, max: 7, int: true }) }), { min: 1, max: 12 }), format: opt(oneOf('slots')) }),
    run: ({ startDate, weeks, channels }) => {
      const start = new Date(`${startDate}T00:00:00Z`);
      if (Number.isNaN(start.getTime()) || start.toISOString().slice(0, 10) !== startDate) throw new Error('startDate must be a valid YYYY-MM-DD');
      const slots: { date: string; channel: string; status: 'unplanned' }[] = [];
      for (let w = 0; w < weeks; w++) for (const ch of channels) for (let k = 0; k < ch.postsPerWeek; k++) {
        const day = Math.floor((k * 7) / ch.postsPerWeek);
        const d = new Date(start.getTime() + (w * 7 + day) * 86400_000);
        slots.push({ date: d.toISOString().slice(0, 10), channel: ch.name, status: 'unplanned' });
      }
      slots.sort((a, b) => (a.date === b.date ? a.channel.localeCompare(b.channel) : a.date.localeCompare(b.date)));
      return { slots, total: slots.length, note: 'Empty publishing slots. Content for each slot is drafted by agents and published only after approval.' };
    },
  },
};

/** Example inputs shown in the UI so every runnable capability is usable without reading code. */
export const EXAMPLES: Record<string, unknown> = {
  roas: { revenue: 12000, adSpend: 3000 }, cac: { totalSalesMarketingSpend: 8000, newCustomers: 40 },
  clv: { avgOrderValue: 60, purchasesPerYear: 4, lifespanYears: 3, grossMarginPct: 45, cac: 80 },
  title_tag: { title: 'Handmade Leather Wallets | Free Shipping', keyword: 'leather wallets' },
  meta_description: { text: 'Shop handmade leather wallets crafted to last. Free shipping on orders over $50.', keyword: 'leather wallets' },
  conversion_test: { visitorsA: 5000, conversionsA: 150, visitorsB: 5000, conversionsB: 200 },
  lead_score: { businessEmail: true, pageViews: 6, requestedDemo: true, budgetConfirmed: false, companySize: 80, daysSinceLastActivity: 3 },
  budget_plan: { total: 5000, reservePct: 10, channels: [{ name: 'Search', weight: 5 }, { name: 'Social', weight: 3 }, { name: 'Email', weight: 2 }] },
  content_calendar: { startDate: '2026-12-01', weeks: 4, channels: [{ name: 'Instagram', postsPerWeek: 3 }, { name: 'LinkedIn', postsPerWeek: 2 }] },
};

Object.assign(WORKFLOWS, MORE);
Object.assign(EXAMPLES, MORE_EXAMPLES);
