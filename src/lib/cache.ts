// Small in-memory cache for the heavy reads (computed Bkg, computed Exp, P&L inputs).
// Every page used to recalculate all bookings and all Exp rows on each click; now the result is reused until
//   - something is saved (bumpData() is called by every server action), or
//   - it is older than TTL (covers another server instance having saved something).
// Concurrent requests share one calculation instead of each doing their own.
const TTL_MS = 60_000;

const g = globalThis as unknown as { __dataVersion?: number; __memo?: Map<string, { at: number; v: number; p: Promise<unknown> }> };
g.__dataVersion ??= 0;
g.__memo ??= new Map();

/** Call after any write: the next read recalculates. */
export function bumpData() {
  g.__dataVersion = (g.__dataVersion ?? 0) + 1;
}

export function memo<T>(key: string, load: () => Promise<T>, ttl = TTL_MS): Promise<T> {
  const m = g.__memo!;
  const hit = m.get(key);
  if (hit && hit.v === g.__dataVersion && Date.now() - hit.at < ttl) return hit.p as Promise<T>;
  const p = load().catch((e) => {
    if (m.get(key)?.p === p) m.delete(key); // never cache a failure
    throw e;
  });
  m.set(key, { at: Date.now(), v: g.__dataVersion!, p });
  return p;
}
