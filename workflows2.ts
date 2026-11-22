import { arr, num, obj, oneOf, opt, str } from '../ai/schema.ts';
import type { Workflow } from './workflows.ts';

const r2 = (n: number): number => Math.round(n * 100) / 100;
const httpUrl = (u: string): URL => { let x: URL; try { x = new URL(u); } catch { throw new Error('url must be a valid absolute URL'); } if (x.protocol !== 'http:' && x.protocol !== 'https:') throw new Error('url must be http(s)'); return x; };
const slug = (s: string): string => s.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '');
const GSM = '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞ ÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà';
const GSM_EXT = '^{}\\[~]|€';
const POWER = ['free', 'new', 'proven', 'secret', 'now', 'guaranteed', 'easy', 'instant', 'exclusive', 'limited', 'save', 'you', 'discover', 'best'];
const syll = (w: string): number => { const m = w.toLowerCase().replace(/e$/, '').match(/[aeiouy]+/g); return Math.max(1, m ? m.length : 0); };

export const MORE: Record<string, Workflow> = {
  schema_markup: {
    schema: obj({ type: oneOf('Organization', 'LocalBusiness', 'Product', 'FAQPage'), name: str({ min: 1, max: 200 }), url: opt(str({ max: 2000 })), description: opt(str({ max: 1000 })), telephone: opt(str({ max: 40 })),
      address: opt(str({ max: 300 })), price: opt(num({ min: 0 })), currency: opt(str({ min: 3, max: 3 })), faqs: opt(arr(obj({ q: str({ min: 1, max: 300 }), a: str({ min: 1, max: 2000 }) }), { max: 50 })) }),
    run: (i) => {
      if (i.url) httpUrl(i.url);
      const base: Record<string, unknown> = { '@context': 'https://schema.org', '@type': i.type };
      if (i.type === 'FAQPage') {
        if (!i.faqs?.length) throw new Error('FAQPage requires at least one faq');
        base.mainEntity = i.faqs.map((f: any) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } }));
      } else {
        base.name = i.name; if (i.url) base.url = i.url; if (i.description) base.description = i.description;
        if (i.type !== 'Product' && i.telephone) base.telephone = i.telephone; if (i.type === 'LocalBusiness' && i.address) base.address = i.address;
        if (i.type === 'Product') { if (i.price !== undefined) { if (!i.currency) throw new Error('currency required with price'); base.offers = { '@type': 'Offer', price: String(i.price), priceCurrency: i.currency.toUpperCase() }; } }
      }
      const json = JSON.stringify(base, null, 2).replace(/</g, '\\u003c'); // cannot break out of <script>
      return { jsonLd: base, scriptTag: `<script type="application/ld+json">\n${json}\n</script>`, note: 'Validate with Google Rich Results Test before deploying; eligibility for rich results is not guaranteed.' };
    },
  },
  utm_builder: {
    schema: obj({ url: str({ min: 8, max: 2000 }), source: str({ min: 1, max: 100 }), medium: str({ min: 1, max: 100 }), campaign: str({ min: 1, max: 100 }), term: opt(str({ max: 100 })), content: opt(str({ max: 100 })) }),
    run: (i) => { const u = httpUrl(i.url); for (const k of ['source', 'medium', 'campaign', 'term', 'content']) if (i[k]) u.searchParams.set(`utm_${k}`, slug(i[k])); return { url: u.toString(), note: 'Covers UTM tagging only (attribution hygiene), not full attribution modelling.' }; },
  },
  sms_segments: {
    schema: obj({ text: str({ min: 1, max: 5000 }) }),
    run: ({ text }) => {
      let units = 0, gsm = true;
      for (const ch of text) { if (GSM.includes(ch)) units += 1; else if (GSM_EXT.includes(ch)) units += 2; else { gsm = false; break; } }
      if (!gsm) units = text.length; // UTF-16 code units
      const [single, multi] = gsm ? [160, 153] : [70, 67];
      return { encoding: gsm ? 'GSM-7' : 'UCS-2', units, segments: units <= single ? 1 : Math.ceil(units / multi), perSegment: units <= single ? single : multi, note: 'Carriers may differ slightly; consent and opt-out wording are legal requirements in most regions.' };
    },
  },
  readability: {
    schema: obj({ text: str({ min: 3, max: 50_000 }) }),
    run: ({ text }) => {
      const words = text.match(/[A-Za-z']+/g) ?? []; if (!words.length) throw new Error('text must contain words');
      const sentences = Math.max(1, (text.match(/[.!?]+(\s|$)/g) ?? []).length), syl = words.reduce((a: number, w: string) => a + syll(w), 0);
      const fre = 206.835 - 1.015 * (words.length / sentences) - 84.6 * (syl / words.length);
      return { words: words.length, sentences, avgWordsPerSentence: r2(words.length / sentences), fleschReadingEase: r2(fre), band: fre >= 80 ? 'easy' : fre >= 60 ? 'plain English' : fre >= 30 ? 'difficult' : 'very difficult', note: 'English-only heuristic.' };
    },
  },
  keyword_density: {
    schema: obj({ text: str({ min: 1, max: 100_000 }), keyword: str({ min: 1, max: 100 }) }),
    run: ({ text, keyword }) => {
      const esc = keyword.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), count = (text.match(new RegExp(`\\b${esc}\\b`, 'gi')) ?? []).length, words = (text.match(/\S+/g) ?? []).length;
      const d = words ? (count * keyword.trim().split(/\s+/).length * 100) / words : 0;
      return { occurrences: count, totalWords: words, densityPct: r2(d), flag: d > 3 ? 'possible keyword stuffing (>3%)' : count === 0 ? 'keyword absent' : 'ok' };
    },
  },
  sample_size: {
    schema: obj({ baselineRatePct: num({ min: 0.1, max: 99 }), minDetectableLiftPct: num({ min: 1, max: 500 }), alphaPct: opt(num()), powerPct: opt(num()) }),
    run: ({ baselineRatePct, minDetectableLiftPct, alphaPct = 5, powerPct = 80 }) => {
      const za = ({ 10: 1.645, 5: 1.96, 1: 2.576 } as Record<number, number>)[alphaPct], zb = ({ 80: 0.8416, 90: 1.2816 } as Record<number, number>)[powerPct];
      if (!za || !zb) throw new Error('alphaPct must be 1|5|10 and powerPct 80|90');
      const p1 = baselineRatePct / 100, p2 = p1 * (1 + minDetectableLiftPct / 100); if (p2 >= 1) throw new Error('target rate must be below 100%');
      const pb = (p1 + p2) / 2, n = Math.pow(za * Math.sqrt(2 * pb * (1 - pb)) + zb * Math.sqrt(p1 * (1 - p1) + p2 * (1 - p2)), 2) / Math.pow(p2 - p1, 2);
      return { perVariant: Math.ceil(n), total: Math.ceil(n) * 2, targetRatePct: r2(p2 * 100), note: 'Two-sided, two-proportion test; fix sample size in advance and do not stop early on a peek.' };
    },
  },
  campaign_metrics: {
    schema: obj({ impressions: num({ min: 0 }), clicks: num({ min: 0 }), spend: num({ min: 0 }), conversions: num({ min: 0 }), revenue: opt(num({ min: 0 })) }),
    run: (m) => {
      if (m.clicks > m.impressions) throw new Error('clicks cannot exceed impressions'); if (m.conversions > m.clicks) throw new Error('conversions cannot exceed clicks');
      const div = (a: number, b: number): number | null => (b > 0 ? r2(a / b) : null);
      return { ctrPct: m.impressions ? r2((m.clicks / m.impressions) * 100) : null, cpc: div(m.spend, m.clicks), cpm: m.impressions ? r2((m.spend / m.impressions) * 1000) : null, cpa: div(m.spend, m.conversions),
        cvrPct: m.clicks ? r2((m.conversions / m.clicks) * 100) : null, roas: m.revenue !== undefined ? div(m.revenue, m.spend) : null };
    },
  },
  churn: {
    schema: obj({ customersAtStart: num({ min: 1, int: true }), customersLost: num({ min: 0, int: true }) }),
    run: ({ customersAtStart, customersLost }) => {
      if (customersLost > customersAtStart) throw new Error('lost cannot exceed starting customers');
      const c = customersLost / customersAtStart;
      return { churnPct: r2(c * 100), retentionPct: r2((1 - c) * 100), expectedLifetimePeriods: c > 0 ? r2(1 / c) : null, note: 'Per-period churn on the starting cohort; new customers excluded.' };
    },
  },
  nps: {
    schema: obj({ scores: arr(num({ min: 0, max: 10, int: true }), { min: 1, max: 100_000 }) }),
    run: ({ scores }) => {
      const n = scores.length, p = scores.filter((s: number) => s >= 9).length, d = scores.filter((s: number) => s <= 6).length;
      return { responses: n, promoters: p, passives: n - p - d, detractors: d, nps: Math.round(((p - d) / n) * 100), caution: n < 30 ? 'Small sample: NPS is volatile below ~30 responses.' : undefined };
    },
  },
  headline_lint: {
    schema: obj({ headline: str({ min: 1, max: 300 }) }),
    run: ({ headline }) => {
      const words = headline.trim().split(/\s+/), issues: string[] = [];
      if (headline.length > 70) issues.push('Over 70 characters: may truncate.'); if (headline.length < 20) issues.push('Under 20 characters: may lack specificity.');
      if (headline === headline.toUpperCase() && /[A-Z]/.test(headline)) issues.push('ALL CAPS reduces readability.'); if (/[!?]{2,}/.test(headline)) issues.push('Repeated punctuation.');
      return { characters: headline.length, words: words.length, hasNumber: /\d/.test(headline), isQuestion: headline.trim().endsWith('?'), powerWords: words.map((w: string) => w.toLowerCase().replace(/\W/g, '')).filter((w: string) => POWER.includes(w)), issues, ok: issues.length === 0 };
    },
  },
  price_margin: {
    schema: obj({ price: num({ min: 0.01 }), unitCost: num({ min: 0 }) }),
    run: ({ price, unitCost }) => ({ grossMarginPct: r2(((price - unitCost) / price) * 100), markupPct: unitCost > 0 ? r2(((price - unitCost) / unitCost) * 100) : null, breakevenRoas: price > unitCost ? r2(price / (price - unitCost)) : null,
      note: 'Breakeven ROAS = price / unit margin; ignores shipping, fees and returns.' }),
  },
};
export const MORE_EXAMPLES: Record<string, unknown> = {
  schema_markup: { type: 'LocalBusiness', name: 'Acme Coffee', url: 'https://acme.example', telephone: '+1-555-0100', address: '1 Main St, Springfield' },
  utm_builder: { url: 'https://acme.example/sale', source: 'Instagram', medium: 'paid social', campaign: 'Black Friday 2026' },
  sms_segments: { text: 'Flash sale today only! 20% off all roasts. Reply STOP to opt out.' },
  readability: { text: 'Our coffee is fresh. We roast it every week. You will taste the difference.' },
  keyword_density: { text: 'Fresh coffee beans roasted weekly. Buy coffee beans online.', keyword: 'coffee beans' },
  sample_size: { baselineRatePct: 5, minDetectableLiftPct: 20 },
  campaign_metrics: { impressions: 100000, clicks: 2500, spend: 1800, conversions: 120, revenue: 7200 },
  churn: { customersAtStart: 1000, customersLost: 45 },
  nps: { scores: [10, 9, 9, 8, 7, 6, 3, 10, 9, 8] },
  headline_lint: { headline: '7 Proven Ways to Cut Your Ad Costs Now' },
  price_margin: { price: 100, unitCost: 60 },
};
