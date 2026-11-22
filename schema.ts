export type Result<T> = { ok: true; value: T } | { ok: false; error: string };
export type Schema<T> = (v: unknown, path?: string) => Result<T>;
const fail = (path: string, m: string): { ok: false; error: string } => ({ ok: false, error: `${path || 'value'}: ${m}` });

export const str = (o: { min?: number; max?: number } = {}): Schema<string> => (v, p = '') =>
  typeof v !== 'string' ? fail(p, 'expected string') : v.length < (o.min ?? 0) || v.length > (o.max ?? 100_000) ? fail(p, 'length out of range') : { ok: true, value: v };
export const num = (o: { min?: number; max?: number; int?: boolean } = {}): Schema<number> => (v, p = '') =>
  typeof v !== 'number' || !Number.isFinite(v) ? fail(p, 'expected finite number')
  : (o.int && !Number.isInteger(v)) || v < (o.min ?? -Infinity) || v > (o.max ?? Infinity) ? fail(p, 'number out of range') : { ok: true, value: v };
export const bool = (): Schema<boolean> => (v, p = '') => (typeof v === 'boolean' ? { ok: true, value: v } : fail(p, 'expected boolean'));
export const opt = <T>(s: Schema<T>): Schema<T | undefined> => (v, p = '') => (v === undefined ? { ok: true, value: undefined } : s(v, p));
export const arr = <T>(s: Schema<T>, o: { max?: number; min?: number } = {}): Schema<T[]> => (v, p = '') => {
  if (!Array.isArray(v)) return fail(p, 'expected array');
  if (v.length > (o.max ?? 1000) || v.length < (o.min ?? 0)) return fail(p, 'array length out of range');
  const out: T[] = [];
  for (let i = 0; i < v.length; i++) { const r = s(v[i], `${p}[${i}]`); if (!r.ok) return r; out.push(r.value); }
  return { ok: true, value: out };
};
export const oneOf = <T extends string>(...vals: T[]): Schema<T> => (v, p = '') => (vals.includes(v as T) ? { ok: true, value: v as T } : fail(p, `expected one of ${vals.join('|')}`));
export const obj = <T extends Record<string, unknown>>(shape: { [K in keyof T]: Schema<T[K]> }): Schema<T> => (v, p = '') => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return fail(p, 'expected object');
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(shape)) {
    const r = (shape as Record<string, Schema<unknown>>)[k]!((v as Record<string, unknown>)[k], p ? `${p}.${k}` : k);
    if (!r.ok) return r;
    if (r.value !== undefined) out[k] = r.value;
  }
  for (const k of Object.keys(v as object)) if (!(k in shape)) return fail(p ? `${p}.${k}` : k, 'unexpected field');
  return { ok: true, value: out as T };
};
export const any = (): Schema<unknown> => (v) => ({ ok: true, value: v });
