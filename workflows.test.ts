import test from 'node:test';
import assert from 'node:assert/strict';
import { EXAMPLES, WORKFLOWS } from '../src/capabilities/workflows.ts';

const run = (k: string, i: unknown): any => { const w = WORKFLOWS[k]!, v = w.schema(i); assert.ok(v.ok, v.ok ? '' : v.error); return w.run(v.ok ? v.value : null); };

test('every example input validates and runs', () => { for (const k of Object.keys(WORKFLOWS)) assert.doesNotThrow(() => run(k, EXAMPLES[k]), k); assert.deepEqual(Object.keys(WORKFLOWS).sort(), Object.keys(EXAMPLES).sort()); });
test('ROAS / CAC / CLV', () => {
  assert.equal(run('roas', { revenue: 12000, adSpend: 3000 }).roas, 4);
  assert.equal(WORKFLOWS.roas!.schema({ revenue: 1, adSpend: 0 }).ok, false);
  assert.equal(run('cac', { totalSalesMarketingSpend: 8000, newCustomers: 40 }).cac, 200);
  const c = run('clv', { avgOrderValue: 60, purchasesPerYear: 4, lifespanYears: 3, grossMarginPct: 50, cac: 120 });
  assert.equal(c.clv, 360); assert.equal(c.ltvToCac, 3);
});
test('SEO linters', () => {
  assert.equal(run('title_tag', { title: 'x'.repeat(70) }).ok, false);
  assert.equal(run('title_tag', { title: 'Leather Wallets for Everyday Carry | Shop', keyword: 'leather wallets' }).ok, true);
  assert.ok(run('title_tag', { title: 'Shop', keyword: 'wallet' }).issues.length >= 2);
  assert.equal(run('meta_description', { text: 'a'.repeat(200) }).ok, false);
});
test('A/B significance', () => {
  const r = run('conversion_test', { visitorsA: 5000, conversionsA: 150, visitorsB: 5000, conversionsB: 200 });
  assert.equal(r.rateA, 3); assert.equal(r.rateB, 4); assert.equal(r.significantAt95, true); assert.ok(r.pValue < 0.05 && r.pValue > 0.001);
  const n = run('conversion_test', { visitorsA: 1000, conversionsA: 100, visitorsB: 1000, conversionsB: 101 });
  assert.equal(n.significantAt95, false);
  assert.throws(() => run('conversion_test', { visitorsA: 10, conversionsA: 11, visitorsB: 10, conversionsB: 1 }));
});
test('lead scoring', () => {
  assert.equal(run('lead_score', { businessEmail: true, pageViews: 10, requestedDemo: true, budgetConfirmed: true, companySize: 500, daysSinceLastActivity: 1 }).grade, 'hot');
  assert.equal(run('lead_score', { businessEmail: false, pageViews: 0, requestedDemo: false, budgetConfirmed: false, companySize: 1, daysSinceLastActivity: 90 }).grade, 'cold');
});
test('budget plan allocates every cent exactly', () => {
  const r = run('budget_plan', { total: 100, reservePct: 10, channels: [{ name: 'a', weight: 1 }, { name: 'b', weight: 1 }, { name: 'c', weight: 1 }] });
  assert.equal(r.reserve, 10); const sum = Math.round(r.allocations.reduce((s: number, x: any) => s + x.amount * 100, 0)); assert.equal(sum, 9000);
  assert.throws(() => run('budget_plan', { total: 100, reservePct: 0, channels: [{ name: 'a', weight: 0 }] }));
});
test('content calendar', () => {
  const r = run('content_calendar', { startDate: '2026-12-01', weeks: 2, channels: [{ name: 'IG', postsPerWeek: 3 }, { name: 'LI', postsPerWeek: 1 }] });
  assert.equal(r.total, 8); assert.equal(r.slots[0].date, '2026-12-01');
  assert.throws(() => run('content_calendar', { startDate: '2026-02-30', weeks: 1, channels: [{ name: 'x', postsPerWeek: 1 }] }));
});

test('schema markup builds safe JSON-LD', () => {
  const r = run('schema_markup', { type: 'FAQPage', name: 'x', faqs: [{ q: 'Open?', a: 'Yes </script><script>alert(1)' }] });
  assert.equal(r.jsonLd.mainEntity[0].acceptedAnswer.text.includes('</script>'), true); assert.ok(!r.scriptTag.slice(60, -9).includes('</script>'), 'cannot break out of the script tag');
  assert.equal(run('schema_markup', { type: 'Product', name: 'Mug', price: 12.5, currency: 'usd' }).jsonLd.offers.priceCurrency, 'USD');
  assert.throws(() => run('schema_markup', { type: 'FAQPage', name: 'x' })); assert.throws(() => run('schema_markup', { type: 'Product', name: 'x', price: 1 })); assert.throws(() => run('schema_markup', { type: 'Organization', name: 'x', url: 'javascript:alert(1)' }));
});
test('UTM builder sanitises and preserves existing query', () => {
  assert.equal(run('utm_builder', { url: 'https://a.example/p?x=1', source: 'Insta Gram', medium: 'paid social', campaign: 'BF 2026' }).url, 'https://a.example/p?x=1&utm_source=insta_gram&utm_medium=paid_social&utm_campaign=bf_2026');
  assert.throws(() => run('utm_builder', { url: 'ftp://a.example', source: 'a', medium: 'b', campaign: 'c' }));
});
test('SMS segment calculator (GSM-7 vs UCS-2)', () => {
  assert.equal(run('sms_segments', { text: 'a'.repeat(160) }).segments, 1); assert.equal(run('sms_segments', { text: 'a'.repeat(161) }).segments, 2); assert.equal(run('sms_segments', { text: 'a'.repeat(306) }).segments, 2); assert.equal(run('sms_segments', { text: 'a'.repeat(307) }).segments, 3);
  assert.equal(run('sms_segments', { text: '€'.repeat(80) }).units, 160); assert.equal(run('sms_segments', { text: '€'.repeat(81) }).segments, 2);
  const u = run('sms_segments', { text: 'a'.repeat(70) + '😀' }); assert.equal(u.encoding, 'UCS-2'); assert.equal(u.segments, 2);
});
test('readability, keyword density, headline lint', () => {
  assert.ok(run('readability', { text: 'The cat sat. The dog ran. We had fun.' }).fleschReadingEase > 80);
  assert.ok(run('readability', { text: 'Notwithstanding multifaceted organizational considerations, implementation necessitates comprehensive interdepartmental coordination.' }).fleschReadingEase < 30);
  assert.throws(() => run('readability', { text: '123 456' }));
  const k = run('keyword_density', { text: 'coffee beans are great. coffee beans rule. other words here now', keyword: 'coffee beans' }); assert.equal(k.occurrences, 2); assert.ok(k.densityPct > 3 && k.flag.includes('stuffing'));
  assert.equal(run('keyword_density', { text: 'tea only', keyword: 'coffee' }).flag, 'keyword absent');
  const h = run('headline_lint', { headline: '7 PROVEN WAYS TO SAVE!!' }); assert.equal(h.hasNumber, true); assert.ok(h.issues.length >= 2); assert.ok(h.powerWords.includes('proven'));
});
test('sample size, campaign metrics, churn, NPS, price/margin', () => {
  const n = run('sample_size', { baselineRatePct: 5, minDetectableLiftPct: 20 }).perVariant; assert.ok(n > 7500 && n < 8800, String(n));
  assert.ok(run('sample_size', { baselineRatePct: 5, minDetectableLiftPct: 10 }).perVariant > n); assert.throws(() => run('sample_size', { baselineRatePct: 5, minDetectableLiftPct: 20, alphaPct: 3 }));
  const m = run('campaign_metrics', { impressions: 100000, clicks: 2500, spend: 1800, conversions: 120, revenue: 7200 }); assert.deepEqual([m.ctrPct, m.cpc, m.cpm, m.cpa, m.cvrPct, m.roas], [2.5, 0.72, 18, 15, 4.8, 4]);
  assert.equal(run('campaign_metrics', { impressions: 0, clicks: 0, spend: 5, conversions: 0 }).ctrPct, null); assert.throws(() => run('campaign_metrics', { impressions: 1, clicks: 2, spend: 1, conversions: 0 }));
  const c = run('churn', { customersAtStart: 1000, customersLost: 50 }); assert.equal(c.churnPct, 5); assert.equal(c.expectedLifetimePeriods, 20); assert.equal(run('churn', { customersAtStart: 10, customersLost: 0 }).expectedLifetimePeriods, null);
  assert.equal(run('nps', { scores: [10, 10, 9, 8, 7, 3] }).nps, 33); assert.throws(() => run('nps', { scores: [11] }));
  const pm = run('price_margin', { price: 100, unitCost: 60 }); assert.deepEqual([pm.grossMarginPct, pm.markupPct, pm.breakevenRoas], [40, 66.67, 2.5]); assert.equal(run('price_margin', { price: 10, unitCost: 12 }).breakevenRoas, null);
});
