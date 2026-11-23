// Small in-memory cache for the heavy reads (computed Bkg, computed Exp, P&L inputs).
// Reading every booking and every Exp row from the database costs tens of MB of network transfer, so the result is kept until
//   - something is saved here (bumpData() is called by every server action), or
//   - the database says the data changed (a tiny counter, data_version_seq, that triggers on the core tables advance; one
//     ~10-byte read at most every few seconds per server instance), or
//   - it is older than TTL (safety net).
// Without the counter (older database) it falls back to a short 60 s lifetime.
// Concurrent requests share one calculation instead of each doing their own.
const TTL_MS = 5 * 60_000;
const TTL_NO_COUNTER_MS = 60_000;
const VERSION_CHECK_MS = 3_000;

interface Hit { at: number; v: number; dv: string; p: Promise<unknown> }
const g = globalThis as unknown as { __dataVersion?: number; __memo?: Map<string, Hit>; __dbVer?: { at: number; p: Promise<string> } };
g.__dataVersion ??= 0;
g.__memo ??= new Map();

type Rows = { rows?: { v: string }[] } | { v: string }[];
const rowsOf = (r: unknown) => ((r as { rows?: unknown[] }).rows ?? r) as { v: string }[];

/** The database's change counter ("none" when the counter does not exist or cannot be read). */
function dbVersion(): Promise<string> {
  const c = g.__dbVer;
  if (c && Date.now() - c.at < VERSION_CHECK_MS) return c.p;
  const p = (async () => {
    try {
      const [{ getDb }, { sql }] = await Promise.all([import("./db"), import("drizzle-orm")]);
      const db = await getDb();
      const r = (await db.execute(sql`select (last_value::text || ':' || is_called::text) as v from data_version_seq`)) as unknown as Rows;
      return rowsOf(r)[0]?.v ?? "none";
    } catch {
      return "none";
    }
  })();
  g.__dbVer = { at: Date.now(), p };
  return p;
}

/** Bumps the database counter (after a write has committed) so the other server instances reload. */
async function bumpDb(): Promise<void> {
  try {
    const [{ getDb }, { sql }] = await Promise.all([import("./db"), import("drizzle-orm")]);
    await (await getDb()).execute(sql`select nextval('data_version_seq')`);
  } catch { /* older database without the counter */ }
  g.__dbVer = undefined;
}

/** Call after any write: the next read recalculates (here at once; on the other instances once the counter moves). */
export function bumpData() {
  g.__dataVersion = (g.__dataVersion ?? 0) + 1;
  g.__dbVer = undefined;
  // after the response is sent, so the write has committed before other instances see the new counter
  import("next/server").then(({ after }) => {
    try { after(() => bumpDb()); } catch { void bumpDb(); }
  }).catch(() => void bumpDb());
}

export function memo<T>(key: string, load: () => Promise<T>, ttl?: number): Promise<T> {
  return (async () => {
    const dv = await dbVersion();
    const life = ttl ?? (dv === "none" ? TTL_NO_COUNTER_MS : TTL_MS);
    const m = g.__memo!;
    const hit = m.get(key);
    if (hit && hit.v === g.__dataVersion && hit.dv === dv && Date.now() - hit.at < life) return hit.p as Promise<T>;
    const p = load().catch((e) => {
      if (m.get(key)?.p === p) m.delete(key); // never cache a failure
      throw e;
    });
    m.set(key, { at: Date.now(), v: g.__dataVersion!, dv, p });
    return p;
  })();
}
