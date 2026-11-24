// Numbers for the two dashboards (Performance & P&L, Receivables & Collections), for the whole company or for one Director /
// Builder / Project (any combination). Pure functions over plain rows so they can be tested.

export interface DBk {
  id: string; status: string; month: number; area: number; rev: number;
  director: string; builder: string; project: string; branch: string;
  rcra: string; raPct: number; coRev: number; coRevRA: number;
  pendDue: number; futDue: number; billOS: number;
  share: number; shareRA: number; // ShareAmt of the booking's Director level (the chain up to the Director), before overrides
}
export interface DExp { date: number; head: string; mode: string; signed: number; bkgId: string }
export interface Scope { director: string; builder: string; project: string }
export type By = "director" | "builder" | "project" | "branch";
export const BY_LABEL: Record<By, string> = { director: "Director", builder: "Builder", project: "Project", branch: "Branch" };

const SOLD = new Set(["live", "not live"]);
export const isSold = (status: string) => SOLD.has(status.trim().toLowerCase());
export const isCancel = (status: string) => status.trim().toLowerCase() === "cancel";
const EPOCH = Date.UTC(1899, 11, 30);
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const ymOf = (serial: number) => new Date(EPOCH + serial * 86400000).toISOString().slice(0, 7);
const lc = (s: string) => s.trim().toLowerCase();

export const inScope = (b: DBk, sc: Scope) =>
  (!sc.director || lc(b.director) === lc(sc.director)) && (!sc.builder || lc(b.builder) === lc(sc.builder)) && (!sc.project || lc(b.project) === lc(sc.project));
export const isScoped = (sc: Scope) => !!(sc.director || sc.builder || sc.project);

/** Calendar quarter of a date, e.g. 2026-Q2. */
export const qKey = (serial: number) => { const d = new Date(EPOCH + serial * 86400000); return `${d.getUTCFullYear()}-Q${Math.floor(d.getUTCMonth() / 3) + 1}`; };

/** The quarters of the window as buckets (the first and last are clipped to the window). */
export function quarterBuckets(from: number, to: number): { key: string; label: string; from: number; to: number }[] {
  const out: { key: string; label: string; from: number; to: number }[] = [];
  const f = new Date(EPOCH + from * 86400000);
  for (let t = Date.UTC(f.getUTCFullYear(), Math.floor(f.getUTCMonth() / 3) * 3, 1); t <= EPOCH + to * 86400000; ) {
    const d = new Date(t);
    const next = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 3, 1);
    const q = Math.floor(d.getUTCMonth() / 3) + 1;
    out.push({ key: `${d.getUTCFullYear()}-Q${q}`, label: `Q${q} ${String(d.getUTCFullYear()).slice(2)}`, from: Math.max(from, Math.round((t - EPOCH) / 86400000)), to: Math.min(to, Math.round((next - EPOCH) / 86400000) - 1) });
    t = next;
  }
  return out;
}

const nameOnly = (s: string) => s.split("~")[0];
export function keyOf(b: DBk, by: By): string {
  const v = by === "director" ? nameOnly(b.director) : by === "builder" ? b.builder : by === "project" ? b.project : b.branch;
  return v.trim() || "(none)";
}

// ------------------------------------------------------------------ Performance

export interface Perf {
  bookings: number; live: number; notLive: number; cancelled: number; cancelRate: number; area: number; revenue: number; share: number; shareRA: number;
  months: { key: string; label: string; from: number; to: number; bookings: number; revenue: number; share: number }[];
}
export function perf(bks: DBk[], from: number, to: number): Perf {
  const w = bks.filter((b) => b.month >= from && b.month <= to);
  const sold = w.filter((b) => isSold(b.status));
  const months = quarterBuckets(from, to).map((m) => ({ ...m, bookings: 0, revenue: 0, share: 0 }));
  const at = new Map(months.map((m) => [m.key, m]));
  let area = 0, revenue = 0, share = 0, shareRA = 0;
  for (const b of sold) {
    area += b.area; revenue += b.rev; share += b.share; shareRA += b.shareRA;
    const m = at.get(qKey(b.month));
    if (m) { m.bookings++; m.revenue += b.rev; m.share += b.share; }
  }
  const cancelled = w.filter((b) => isCancel(b.status)).length;
  const all = sold.length + cancelled;
  return {
    bookings: sold.length, live: sold.filter((b) => lc(b.status) === "live").length, notLive: sold.filter((b) => lc(b.status) === "not live").length,
    cancelled, cancelRate: all ? cancelled / all : 0, area, revenue, share, shareRA, months,
  };
}

export interface Rank { name: string; count: number; revenue: number; share: number; area: number }
export function rank(bks: DBk[], by: By, from: number, to: number, top = 12): Rank[] {
  const m = new Map<string, Rank>();
  for (const b of bks) {
    if (!isSold(b.status) || b.month < from || b.month > to) continue;
    const k = keyOf(b, by);
    const r = m.get(k) ?? { name: k, count: 0, revenue: 0, share: 0, area: 0 };
    r.count++; r.revenue += b.rev; r.share += b.share; r.area += b.area;
    m.set(k, r);
  }
  return [...m.values()].sort((a, b) => b.revenue - a.revenue || b.count - a.count).slice(0, top);
}

// ------------------------------------------------------------------ Receivables & collections

export type Stage = "RA Close" | "RA Open" | "RC open" | "Other";
/** RA Close = RA% above zero (25% ... 100% RA Close); RA Open = "RC Close/RA Open"; RC open = nothing closed yet; Other = hold / not live / pref. */
export function stageOf(rcra: string, raPct: number): Stage {
  if (raPct > 0) return "RA Close";
  if (/ra open/i.test(rcra)) return "RA Open";
  if (/^rc open/i.test(rcra)) return "RC open";
  return "Other";
}
export const STAGES: Stage[] = ["RA Close", "RA Open", "RC open", "Other"];

export interface Receiv {
  stage: Record<Stage, { count: number; coRev: number; coRevRA: number }>;
  pendDue: number; dueBookings: number; futDue: number; billOS: number; billBookings: number;
  collections: number; recdClient: number; formRevised: number;
  brokerage: number; noc: number; billed: number;
  months: { key: string; label: string; recdClient: number; formRevised: number; brokerage: number }[];
}

export function receiv(bks: DBk[], exps: DExp[], sc: Scope, from: number, to: number): Receiv {
  const scoped = isScoped(sc);
  const ids = new Set(bks.filter((b) => inScope(b, sc)).map((b) => lc(b.id)));
  const stage = Object.fromEntries(STAGES.map((s) => [s, { count: 0, coRev: 0, coRevRA: 0 }])) as Receiv["stage"];
  let pendDue = 0, dueBookings = 0, futDue = 0, billOS = 0, billBookings = 0;
  for (const b of bks) {
    if (!isSold(b.status) || !inScope(b, sc)) continue;
    // stage: the bookings of the period; receivables: every live booking as of today
    if (b.month >= from && b.month <= to) { const s = stage[stageOf(b.rcra, b.raPct)]; s.count++; s.coRev += b.coRev; s.coRevRA += b.coRevRA; }
    pendDue += b.pendDue; futDue += b.futDue; billOS += b.billOS;
    if (b.pendDue > 0.5) dueBookings++;
    if (b.billOS > 0.5) billBookings++;
  }
  const months = quarterBuckets(from, to).map((m) => ({ key: m.key, label: m.label, recdClient: 0, formRevised: 0, brokerage: 0 }));
  const at = new Map(months.map((m) => [m.key, m]));
  let recdClient = 0, formRevised = 0, brokerage = 0, noc = 0, billed = 0;
  for (const e of exps) {
    if (e.date < from || e.date > to) continue;
    if (scoped && !ids.has(lc(e.bkgId))) continue;
    const h = lc(e.head), mode = lc(e.mode), m = at.get(qKey(e.date));
    if (h === "recd from client") { recdClient += e.signed; if (m) m.recdClient += e.signed; }
    else if (h === "form revised") { formRevised += e.signed; if (m) m.formRevised += e.signed; }
    else if (h === "brokerage recd") {
      if (mode === "billing") billed += e.signed;
      else if (mode === "noc") noc += e.signed;
      else { brokerage += e.signed; if (m) m.brokerage += e.signed; }
    }
  }
  return { stage, pendDue, dueBookings, futDue, billOS, billBookings, collections: recdClient + formRevised, recdClient, formRevised, brokerage, noc, billed, months };
}

/** Receivable / collection totals per Director, Builder, Project or Branch (the unlinked Exp rows count as "(not linked)"). */
export function rankReceiv(bks: DBk[], exps: DExp[], sc: Scope, by: By, from: number, to: number) {
  const idx = new Map(bks.map((b) => [lc(b.id), b]));
  const m = new Map<string, { name: string; pendDue: number; billOS: number; collections: number; brokerage: number }>();
  const row = (k: string) => { const r = m.get(k) ?? { name: k, pendDue: 0, billOS: 0, collections: 0, brokerage: 0 }; m.set(k, r); return r; };
  for (const b of bks) {
    if (!isSold(b.status) || !inScope(b, sc)) continue;
    const r = row(keyOf(b, by));
    r.pendDue += b.pendDue; r.billOS += b.billOS;
  }
  for (const e of exps) {
    if (e.date < from || e.date > to) continue;
    const h = lc(e.head), mode = lc(e.mode);
    const coll = h === "recd from client" || h === "form revised", brk = h === "brokerage recd" && mode !== "billing" && mode !== "noc";
    if (!coll && !brk) continue;
    const b = idx.get(lc(e.bkgId));
    if (b ? !inScope(b, sc) : isScoped(sc)) continue;
    const r = row(b ? keyOf(b, by) : "(not linked)");
    if (coll) r.collections += e.signed; else r.brokerage += e.signed;
  }
  return [...m.values()];
}
