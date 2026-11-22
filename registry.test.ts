import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { Registry } from '../src/capabilities/registry.ts';
import { WORKFLOWS } from '../src/capabilities/workflows.ts';
import { DIVISIONS } from '../src/ai/agents.ts';

const reg = Registry.load();
test('registry: exactly 705 unique entries across all 15 divisions', () => {
  assert.equal(reg.all.length, 705); assert.equal(reg.byId.size, 705);
  assert.deepEqual(new Set(reg.all.map((c) => c.division)), new Set(DIVISIONS));
  assert.equal(reg.all.filter((c) => c.kind === 'tool').length, 74);
});
test('status honesty: every claim is backed by a real implementation and an existing test file', () => {
  const eng = reg.all.filter((c) => c.implementation_status === 'engine_tested'), tpl = reg.all.filter((c) => c.implementation_status === 'template_runnable');
  assert.equal(eng.length, 21); assert.equal(tpl.length, 610);
  for (const c of eng) { assert.ok(c.workflow && WORKFLOWS[c.workflow], c.id); assert.ok(c.test_refs.every((t) => existsSync(new URL(`../${t}`, import.meta.url))), c.id); }
  for (const c of tpl) { assert.ok(!c.workflow && c.archetype && c.kind === 'capability', c.id); assert.ok(c.test_refs.every((t) => existsSync(new URL(`../${t}`, import.meta.url))), c.id); }
  assert.equal(reg.all.filter((c) => c.implementation_status === 'implemented_tested').length, 0, 'none meets the full definition of done');
});
test('routing & search', () => {
  assert.equal(reg.routeDivision('improve my SEO keyword research and backlinks')[0]!.division, 'Search Engine Lab');
  assert.ok(reg.search({ q: 'return on ad spend' }).length === 1);
});
