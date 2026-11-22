export class RateLimiter {
  capacity: number; refillPerSec: number; now: () => number;
  buckets = new Map<string, { tokens: number; ts: number }>();
  constructor(capacity: number, refillPerSec: number, now: () => number = Date.now) {
    this.capacity = capacity; this.refillPerSec = refillPerSec; this.now = now;
  }
  take(key: string, cost = 1): boolean {
    const t = this.now();
    if (this.buckets.size > 10000) for (const [k, b] of this.buckets) if (t - b.ts > 3600_000) this.buckets.delete(k);
    const b = this.buckets.get(key) ?? { tokens: this.capacity, ts: t };
    b.tokens = Math.min(this.capacity, b.tokens + ((t - b.ts) / 1000) * this.refillPerSec);
    b.ts = t;
    const ok = b.tokens >= cost;
    if (ok) b.tokens -= cost;
    this.buckets.set(key, b);
    return ok;
  }
}
