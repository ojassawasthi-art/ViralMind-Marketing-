import { isIP } from 'node:net';
import { lookup } from 'node:dns/promises';

export class SsrfError extends Error {}

function v4(ip: string): number[] { return ip.split('.').map(Number); }

function expandV6(ip: string): number[] | null {
  let s = ip.toLowerCase().split('%')[0]!;
  if (s.includes('.')) { // embedded IPv4 tail
    const i = s.lastIndexOf(':');
    const q = v4(s.slice(i + 1));
    s = s.slice(0, i + 1) + ((q[0]! << 8) | q[1]!).toString(16) + ':' + ((q[2]! << 8) | q[3]!).toString(16);
  }
  const [head, tail] = s.split('::');
  const h = head ? head.split(':') : [];
  const t = tail !== undefined && tail ? tail.split(':') : [];
  const fill = s.includes('::') ? 8 - h.length - t.length : 0;
  const parts = [...h, ...Array(Math.max(fill, 0)).fill('0'), ...t];
  if (parts.length !== 8) return null;
  const nums = parts.map((x) => parseInt(x, 16));
  return nums.some((n) => Number.isNaN(n)) ? null : nums;
}

export function isPrivateIp(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) {
    const [a, b] = v4(ip) as [number, number];
    return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19));
  }
  if (kind === 6) {
    const g = expandV6(ip);
    if (!g) return true;
    if (g.every((x, i) => x === 0 || i === 7 && x === 1)) return true; // :: and ::1
    if ((g[0]! & 0xfe00) === 0xfc00 || (g[0]! & 0xffc0) === 0xfe80 || (g[0]! & 0xff00) === 0xff00) return true;
    const mapped = g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff;
    const nat64 = g[0] === 0x64 && g[1] === 0xff9b;
    if (mapped || nat64) return isPrivateIp(`${g[6]! >> 8}.${g[6]! & 255}.${g[7]! >> 8}.${g[7]! & 255}`) || nat64;
    return false;
  }
  return true; // not an IP => treat as unsafe
}

export interface SsrfOptions {
  resolver?: (host: string) => Promise<string[]>;
  allowedPorts?: number[];
  allowPrivate?: boolean; // tests / explicit self-hosted intranet allowlists only
}

export async function assertSafeUrl(raw: string, opts: SsrfOptions = {}): Promise<{ url: URL; addresses: string[] }> {
  let url: URL;
  try { url = new URL(raw); } catch { throw new SsrfError('invalid URL'); }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new SsrfError('only http/https allowed');
  if (url.username || url.password) throw new SsrfError('credentials in URL not allowed');
  const port = Number(url.port || (url.protocol === 'https:' ? 443 : 80));
  if (!(opts.allowedPorts ?? [80, 443]).includes(port)) throw new SsrfError('port not allowed');
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!opts.allowPrivate && (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')))
    throw new SsrfError('internal hostname blocked');
  const addresses = isIP(host) ? [host] : await (opts.resolver ?? (async (h) => (await lookup(h, { all: true })).map((a) => a.address)))(host);
  if (addresses.length === 0) throw new SsrfError('host did not resolve');
  if (!opts.allowPrivate && addresses.some(isPrivateIp)) throw new SsrfError('address resolves to a private/reserved range');
  return { url, addresses }; // caller MUST connect to addresses[0] (pinning) to defeat DNS rebinding
}
