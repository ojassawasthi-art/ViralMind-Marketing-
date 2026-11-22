const KEY = /secret|token|password|passwd|authorization|api[_-]?key|cookie|credential|private[_-]?key/i;
const VALUE = /(sk-[A-Za-z0-9_-]{16,}|sk-ant-[A-Za-z0-9_-]{16,}|AIza[0-9A-Za-z_-]{20,}|xox[abp]-[A-Za-z0-9-]{10,}|ghp_[A-Za-z0-9]{20,}|Bearer\s+[A-Za-z0-9._~+/=-]{12,})/g;

export function redactString(s: string): string { return s.replace(VALUE, '[REDACTED]'); }

export function redact(v: unknown, depth = 0): unknown {
  if (depth > 6) return '[TRUNCATED]';
  if (typeof v === 'string') return redactString(v);
  if (Array.isArray(v)) return v.map((x) => redact(x, depth + 1));
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, KEY.test(k) ? '[REDACTED]' : redact(x, depth + 1)]));
  }
  return v;
}

export function containsSecret(s: string): boolean { VALUE.lastIndex = 0; return VALUE.test(s); }

export function log(level: 'info' | 'warn' | 'error', msg: string, fields: Record<string, unknown> = {}): void {
  if (process.env.LOG_SILENT === '1') return;
  process.stdout.write(JSON.stringify({ ts: new Date().toISOString(), level, msg, ...(redact(fields) as object) }) + '\n');
}
