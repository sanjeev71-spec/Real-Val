import "server-only";
import { desc, sql } from "drizzle-orm";
import { getDb, schema as s } from "@/lib/db";

// Clean-up proposals. A scan only READS; nothing changes until the Master approves one proposal, and
// the approval re-computes that proposal from the live data before applying it.

type Db = Awaited<ReturnType<typeof getDb>>;
type Row = Record<string, unknown>;
const rowsOf = (r: unknown) => (("rows" in (r as object) ? (r as { rows: Row[] }).rows : r) as Row[]);
const cnt = (r: unknown) => Number((r as { rowCount?: number; affectedRows?: number }).rowCount ?? (r as { affectedRows?: number }).affectedRows ?? 0);
const list = (xs: string[]) => sql.join(xs.map((x) => sql`${x}`), sql`, `);

export interface Change { from: string; to: string; count: number }
export interface Proposal {
  id: string; // stable: kind or kind:key
  kind: "project" | "branch" | "bkgid" | "head" | "mode" | "client";
  title: string;
  why: string;
  affected: number;
  changes: Change[];
  /** for merges: the spellings found, most used first, and the one proposed */
  variants?: { value: string; count: number }[];
  canonical?: string;
}

const norm = (v: string) => v.toLowerCase().replace(/[^a-z0-9]/g, "");
const tidy = (v: string) => v.trim().replace(/\s+/g, " ");

async function counts(db: Db, query: ReturnType<typeof sql>): Promise<Map<string, number>> {
  const m = new Map<string, number>();
  for (const r of rowsOf(await db.execute(query))) { const v = r.v as string | null; if (v && v.trim()) m.set(v, (m.get(v) ?? 0) + Number(r.c)); }
  return m;
}
const merge = (...ms: Map<string, number>[]) => { const o = new Map<string, number>(); for (const m of ms) for (const [k, v] of m) o.set(k, (o.get(k) ?? 0) + v); return o; };

/** Groups spellings that differ only in case, spaces or punctuation. */
function groupVariants(c: Map<string, number>, protect?: Set<string>) {
  const g = new Map<string, { value: string; count: number }[]>();
  for (const [value, count] of c) { const k = norm(value); if (k) g.set(k, [...(g.get(k) ?? []), { value, count }]); }
  return [...g.entries()].filter(([, v]) => v.length > 1).map(([key, v]) => {
    v.sort((a, b) => Number(protect?.has(b.value)) - Number(protect?.has(a.value)) || b.count - a.count || a.value.localeCompare(b.value));
    return { key, variants: v, canonical: v[0].value };
  }).sort((a, b) => b.variants.reduce((x, y) => x + y.count, 0) - a.variants.reduce((x, y) => x + y.count, 0));
}

export async function scanCleanup(): Promise<Proposal[]> {
  const db = await getDb();
  const out: Proposal[] = [];

  // ---- project names
  const [bp, ep, mp] = await Promise.all([
    counts(db, sql`select data->>'Project' as v, count(*) as c from bookings group by 1`),
    counts(db, sql`select project as v, count(*) as c from exp_entries where bkg_id is null or bkg_id = '' group by 1`),
    counts(db, sql`select name as v, 1 as c from projects`),
  ]);
  for (const g of groupVariants(merge(bp, ep, mp), new Set(mp.keys()))) {
    const changes = g.variants.filter((v) => v.value !== g.canonical).map((v) => ({ from: v.value, to: g.canonical, count: v.count }));
    out.push({
      id: `project:${g.key}`, kind: "project", title: `Merge project names → ${g.canonical}`, canonical: g.canonical, variants: g.variants,
      why: "The same project is spelled differently, so its bookings, price list and expenses are split.",
      affected: changes.reduce((a, c) => a + c.count, 0), changes,
    });
  }

  // ---- branches
  const [bb, eb, mb] = await Promise.all([
    counts(db, sql`select data->>'Branch' as v, count(*) as c from bookings group by 1`),
    counts(db, sql`select branch as v, count(*) as c from exp_entries group by 1`),
    counts(db, sql`select branch as v, count(*) as c from employees group by 1`),
  ]);
  for (const g of groupVariants(merge(bb, eb, mb))) {
    const changes = g.variants.filter((v) => v.value !== g.canonical).map((v) => ({ from: v.value, to: g.canonical, count: v.count }));
    out.push({
      id: `branch:${g.key}`, kind: "branch", title: `Merge branch names → ${g.canonical}`, canonical: g.canonical, variants: g.variants,
      why: "Branch totals are split between spellings.", affected: changes.reduce((a, c) => a + c.count, 0), changes,
    });
  }

  // ---- Exp BkgID that points to a booking only after trimming / case
  const ids = rowsOf(await db.execute(sql`
    select e.bkg_id as v, b.bkg_id as t, count(*) as c from exp_entries e
    join bookings b on upper(trim(b.bkg_id)) = upper(trim(e.bkg_id))
    where e.bkg_id is not null and e.bkg_id <> b.bkg_id group by 1, 2 order by 3 desc`));
  if (ids.length) {
    const changes = ids.map((r) => ({ from: String(r.v), to: String(r.t), count: Number(r.c) }));
    out.push({ id: "bkgid", kind: "bkgid", title: "Fix BkgIDs in Exp that differ only in case or spaces", why: "These lines look unlinked to the booking in some places.", affected: changes.reduce((a, c) => a + c.count, 0), changes });
  }

  // ---- Exp head / mode spelled differently from the master
  const heads = rowsOf(await db.execute(sql`
    select e.head as v, h.head as t, count(*) as c from exp_entries e join exp_heads h on lower(trim(h.head)) = lower(trim(e.head))
    where e.head <> h.head group by 1, 2 order by 3 desc`));
  if (heads.length) {
    const changes = heads.map((r) => ({ from: String(r.v), to: String(r.t), count: Number(r.c) }));
    out.push({ id: "head", kind: "head", title: "Use the Head master's spelling in Exp", why: "A head typed in a different case or with spaces is not recognised as income / expense.", affected: changes.reduce((a, c) => a + c.count, 0), changes });
  }
  const modes = rowsOf(await db.execute(sql`
    select e.mode as v, m.name as t, count(*) as c from exp_entries e join modes m on lower(trim(m.name)) = lower(trim(e.mode))
    where e.mode <> m.name group by 1, 2 order by 3 desc`));
  if (modes.length) {
    const changes = modes.map((r) => ({ from: String(r.v), to: String(r.t), count: Number(r.c) }));
    out.push({ id: "mode", kind: "mode", title: "Use the Mode master's spelling in Exp", why: "Cheque lines typed as 'chq' or 'CHQ' miss the cheque rules.", affected: changes.reduce((a, c) => a + c.count, 0), changes });
  }

  // ---- stray spaces in client names
  const cl = rowsOf(await db.execute(sql`select data->>'Client' as v, count(*) as c from bookings where data->>'Client' is not null and (data->>'Client' <> btrim(data->>'Client') or data->>'Client' ~ '\\s{2,}') group by 1 order by 2 desc`));
  if (cl.length) {
    const changes = cl.map((r) => ({ from: String(r.v), to: tidy(String(r.v)), count: Number(r.c) }));
    out.push({ id: "client", kind: "client", title: "Remove stray spaces in client names", why: "Searches for a client miss names with leading, trailing or double spaces.", affected: changes.reduce((a, c) => a + c.count, 0), changes });
  }
  return out;
}

async function renameJsonKey(tx: Parameters<Parameters<Db["transaction"]>[0]>[0], key: string, froms: string[], to: string) {
  const r = await tx.execute(sql`update bookings set data = jsonb_set(data, ${`{${key}}`}::text[], to_jsonb(${to}::text)), updated_at = now() where data->>${key}::text in (${list(froms)})`);
  return cnt(r);
}

/** Applies ONE proposal after the Master approved it. `canonical` (merges only) must be one of the spellings found. */
export async function applyCleanup(userId: number, id: string, canonical?: string): Promise<{ ok: boolean; message: string; affected?: number }> {
  const db = await getDb();
  const p = (await scanCleanup()).find((x) => x.id === id);
  if (!p) return { ok: false, message: "This proposal no longer applies (the data changed). Open Clean-up again." };
  let affected = 0;
  await db.transaction(async (tx) => {
    if (p.kind === "project" || p.kind === "branch") {
      const to = canonical && p.variants?.some((v) => v.value === canonical) ? canonical : p.canonical!;
      const froms = p.variants!.map((v) => v.value).filter((v) => v !== to);
      if (p.kind === "project") {
        affected += await renameJsonKey(tx, "Project", froms, to);
        const e = await tx.execute(sql`update exp_entries set project = ${to} where project in (${list(froms)})`);
        affected += cnt(e);
        await tx.execute(sql`insert into projects (name, location, builder)
          select ${to}, max(location), max(builder) from projects where name in (${list(froms)}) on conflict (name) do nothing`);
        await tx.execute(sql`update projects c set location = coalesce(c.location, v.location), builder = coalesce(c.builder, v.builder)
          from (select max(location) as location, max(builder) as builder from projects where name in (${list(froms)})) v where c.name = ${to}`);
        await tx.execute(sql`delete from projects where name in (${list(froms)})`);
        await tx.execute(sql`update inventory i set project = ${to} where project in (${list(froms)})
          and not exists (select 1 from inventory j where j.project = ${to} and j.unit_no = i.unit_no)`);
        await tx.execute(sql`update price_list set project = ${to} where project in (${list(froms)})`);
      } else {
        affected += await renameJsonKey(tx, "Branch", froms, to);
        const e = await tx.execute(sql`update exp_entries set branch = ${to} where branch in (${list(froms)})`);
        const m = await tx.execute(sql`update employees set branch = ${to} where branch in (${list(froms)})`);
        affected += cnt(e) + cnt(m);
      }
    } else if (p.kind === "bkgid") {
      const r = await tx.execute(sql`update exp_entries e set bkg_id = b.bkg_id from bookings b where upper(trim(b.bkg_id)) = upper(trim(e.bkg_id)) and e.bkg_id <> b.bkg_id`);
      affected = cnt(r);
    } else if (p.kind === "head") {
      const r = await tx.execute(sql`update exp_entries e set head = h.head from exp_heads h where lower(trim(h.head)) = lower(trim(e.head)) and e.head <> h.head`);
      affected = cnt(r);
    } else if (p.kind === "mode") {
      const r = await tx.execute(sql`update exp_entries e set mode = m.name from modes m where lower(trim(m.name)) = lower(trim(e.mode)) and e.mode <> m.name`);
      affected = cnt(r);
    } else if (p.kind === "client") {
      const r = await tx.execute(sql`update bookings set data = jsonb_set(data, '{Client}', to_jsonb(btrim(regexp_replace(data->>'Client', '\\s+', ' ', 'g')))), updated_at = now() where data->>'Client' <> btrim(data->>'Client') or data->>'Client' ~ '\\s{2,}'`);
      affected = cnt(r);
    }
    await tx.insert(s.cleanupRuns).values({ kind: id, detail: { title: p.title, canonical: canonical ?? p.canonical ?? null, changes: p.changes.slice(0, 50) }, affected: affected || p.affected, appliedBy: userId });
  });
  return { ok: true, message: `Done: ${p.title} (${(affected || p.affected).toLocaleString("en-IN")} records).`, affected: affected || p.affected };
}

export async function cleanupHistory() {
  const db = await getDb();
  return db.select().from(s.cleanupRuns).orderBy(desc(s.cleanupRuns.id)).limit(30);
}
