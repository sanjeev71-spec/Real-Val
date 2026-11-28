// P&L reports - a port of the TRPLData "P&L" sheet. Three views of the same numbers:
//   1. TL-wise summary      : one column per team leader under a Director (the Director included)
//   2. Calendar-year summary: the Director's own totals per year
//   3. Director-wise summary: every Director side by side
// "ShareAmt" is the revenue share a person earns from bookings; "ShareAmt x RA%" is the same after the RA% (what has been earned
// so far on recovered revenue). Paid expenses are charged to the Director of the person who incurred them, split between the
// L0 / L1 employees of each Exp row. F&F = ShareAmt - Paid Exp; P&L = ShareAmt x RA% - Paid Exp.
import { codeOf } from "./excel";
import { SEAT_COST_PER_MONTH, SEAT_DAY_BASIS } from "./emp";
import { SEAT_CHARGED } from "../company";

export const PNL_HEADS = [
  "Comm Paid", "Salary Paid", "Incentive", "F&F", "Seat Cost", "Travel", "Misc Income", "Car", "Advtg", "Drawings", "Rent",
  "Electricity", "Interest", "Office Exp", "RERA Exp", "Co. Incentive", "Site Visit Incentive",
] as const;

export interface PnlLevel { emp: string; share: number; shareRA: number }
export interface PnlBooking {
  status: string;
  month: number; // BkgMonth, Excel serial
  director: string; // Bkg.Director "Name~Code"
  rev: number; // DirectorRevenue + SpinToWin + IncentivePOC + IncentiveBuilder
  depth: number; // RS_Depth
  levels: PnlLevel[]; // L0..L4
  overrideEmp: string;
  overrideShare: number;
  overrideShareRA: number;
}
export interface PnlExp {
  head: string;
  expType: string;
  director: string;
  date: number; // ValueDate, Excel serial
  l0Emp: string; l0Amt: number;
  l1Emp: string; l1Amt: number;
}
export interface PnlSeatRow {
  director: string; // Emp.Director of the period
  start: number | null; // seat charge start (serial)
  to: number; // period end (serial; open periods end today)
  positive: boolean; // seat cost of the period > 0
}
/** Every Emp period: who reports to whom, and the employee's RevShare in that period. */
export interface PnlEmpEdge { code: string; name: string; headCode: string; revShare: number }

export interface PnlData {
  bookings: PnlBooking[];
  exps: PnlExp[];
  seats: PnlSeatRow[];
  edges: PnlEmpEdge[];
}

const SOLD = new Set(["live", "not live"]);
const sold = (b: PnlBooking) => SOLD.has(b.status.trim().toLowerCase());
const same = (a: string, b: string) => a !== "" && codeOf(a).toLowerCase() === codeOf(b).toLowerCase();
const sameCode = (a: string, code: string) => code !== "" && codeOf(a).toLowerCase() === code.toLowerCase();
const inWin = (d: number, f: number, t: number) => d >= f && d <= t;

/** DateSerial helpers (Excel serials). */
const EPOCH = Date.UTC(1899, 11, 30);
export const serialOf = (y: number, m: number, d: number) => Math.round((Date.UTC(y, m - 1, d) - EPOCH) / 86400000);
export const yearOf = (s: number) => new Date(EPOCH + s * 86400000).getUTCFullYear();

/** The target and every employee below them (up to six levels, anyone who ever reported up the chain) who carries a RevShare. */
export function pnlTeam(target: string, edges: PnlEmpEdge[]): { code: string; name: string }[] {
  const t = codeOf(target);
  const kids = new Map<string, Set<string>>();
  const maxShare = new Map<string, number>();
  const names = new Map<string, string>();
  for (const e of edges) {
    const c = e.code.toLowerCase();
    if (!names.has(c)) names.set(c, e.name);
    maxShare.set(c, Math.max(maxShare.get(c) ?? 0, e.revShare ?? 0));
    if (e.headCode) {
      const h = e.headCode.toLowerCase();
      const s = kids.get(h) ?? new Set<string>();
      s.add(c);
      kids.set(h, s);
    }
  }
  const out: string[] = [];
  const seen = new Set<string>([t.toLowerCase()]);
  const dfs = (p: string, depth: number) => {
    if (depth > 6) return;
    for (const k of kids.get(p) ?? []) {
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(k);
      dfs(k, depth + 1);
    }
  };
  dfs(t.toLowerCase(), 1);
  const team = [t.toLowerCase(), ...out.filter((c) => (maxShare.get(c) ?? 0) !== 0)];
  return team.map((c) => ({ code: c, name: names.get(c) ?? c }));
}

/** Seat cost charged to a Director over [f, t]: day-based over every employee period under them. */
export function seatCostFor(director: string, seats: PnlSeatRow[], f: number, t: number): number {
  let s = 0;
  for (const r of seats) {
    if (!r.positive || r.start === null || !same(r.director, director)) continue;
    const lo = Math.max(r.start, f - 1);
    const hi = Math.min(r.to, t);
    const days = Math.max(0, hi - lo);
    s += (days / SEAT_DAY_BASIS) * SEAT_COST_PER_MONTH * 12;
  }
  return s;
}

/** Heads shown: the fixed list, only those with paid expense for this Director in the window (Seat Cost always, once it is charged). */
export function pnlHeads(director: string, exps: PnlExp[], f: number, t: number): string[] {
  const has = new Set<string>();
  for (const e of exps) if (e.expType === "Expense" && same(e.director, director) && inWin(e.date, f, t)) has.add(e.head.toLowerCase());
  return PNL_HEADS.filter((h) => has.has(h.toLowerCase()) || (h === "Seat Cost" && SEAT_CHARGED));
}

/** -(L0 + L1 amounts) of a head for a Director in the window; optionally only for one L0/L1 employee. */
function expenseOf(exps: PnlExp[], head: string, director: string, f: number, t: number, who?: string): number {
  let s = 0;
  for (const e of exps) {
    if (e.expType !== "Expense" || e.head.toLowerCase() !== head.toLowerCase() || !same(e.director, director) || !inWin(e.date, f, t)) continue;
    if (who === undefined) s -= e.l0Amt + e.l1Amt;
    else {
      if (sameCode(e.l0Emp, who)) s -= e.l0Amt;
      if (sameCode(e.l1Emp, who)) s -= e.l1Amt;
    }
  }
  return s;
}

function lowestSharer(b: PnlBooking): string {
  for (const l of b.levels) if (l.emp) return codeOf(l.emp);
  return "";
}
const inChain = (b: PnlBooking, code: string) => b.levels.some((l) => sameCode(l.emp, code));

// ------------------------------------------------------------------ 1. TL-wise

export interface TlColumn { code: string; name: string }
export interface TlSummary {
  heads: string[];
  cols: TlColumn[];
  revInc: number[]; share: number[]; shareRA: number[];
  exp: Record<string, number[]>;
  expTotal: number[];
  ff: number[]; pl: number[];
  total: { revInc: number; share: number; shareRA: number; exp: Record<string, number>; expTotal: number; ff: number; pl: number };
}

export function computeTlSummary(data: PnlData, target: string, from: number, to: number): TlSummary {
  const t = codeOf(target);
  const cols = pnlTeam(target, data.edges);
  const heads = pnlHeads(target, data.exps, from, to);
  const relevant = data.bookings.filter((b) => sold(b) && inWin(b.month, from, to));
  const mine = relevant.filter((b) => inChain(b, t));

  const revInc = cols.map((c) => mine.reduce((s, b) => (lowestSharer(b).toLowerCase() === c.code ? s + b.rev : s), 0));
  const shareFor = (key: "share" | "shareRA", ov: "overrideShare" | "overrideShareRA") =>
    cols.map((c) => {
      let s = 0;
      for (const b of mine) b.levels.forEach((l) => { if (sameCode(l.emp, c.code)) s += l[key]; });
      for (const b of relevant) if (sameCode(b.overrideEmp, c.code)) s += b[ov]; // override needs no chain match
      return s;
    });
  const share = shareFor("share", "overrideShare");
  const shareRA = shareFor("shareRA", "overrideShareRA");

  const exp: Record<string, number[]> = {};
  for (const h of heads) {
    exp[h] = cols.map((c) => {
      let v = expenseOf(data.exps, h, target, from, to, c.code);
      if (h === "Seat Cost" && c.code === t.toLowerCase()) v += seatCostFor(target, data.seats, from, to);
      return v;
    });
  }
  const expTotal = cols.map((_, i) => heads.reduce((s, h) => s + exp[h][i], 0));
  const ff = cols.map((_, i) => share[i] - expTotal[i]);
  const pl = cols.map((_, i) => shareRA[i] - expTotal[i]);
  const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
  const tExp: Record<string, number> = {};
  for (const h of heads) tExp[h] = sum(exp[h]);
  const total = {
    revInc: sum(revInc), share: sum(share), shareRA: sum(shareRA), exp: tExp, expTotal: sum(expTotal),
    ff: sum(share) - sum(expTotal), pl: sum(shareRA) - sum(expTotal),
  };
  return { heads, cols, revInc, share, shareRA, exp, expTotal, ff, pl, total };
}

// ------------------------------------------------------------------ 2. Calendar year

export interface YearSummary {
  heads: string[];
  years: number[];
  revInc: number[]; share: number[]; shareRA: number[];
  exp: Record<string, number[]>;
  expTotal: number[];
  ff: number[]; pl: number[];
  total: { revInc: number; share: number; shareRA: number; exp: Record<string, number>; expTotal: number; ff: number; pl: number };
}

/** Cumulative share of the booking from L0 up to and including the level held by `code` (that person plus everyone below). */
function cumulativeShare(b: PnlBooking, code: string, key: "share" | "shareRA"): number {
  let s = 0;
  for (let k = 0; k < b.levels.length; k++) {
    s += b.levels[k][key];
    if (sameCode(b.levels[k].emp, code)) return s;
  }
  return 0;
}

export function computeYearSummary(data: PnlData, target: string, from: number, to: number): YearSummary {
  const t = codeOf(target);
  const heads = pnlHeads(target, data.exps, from, to);
  const y0 = yearOf(from), y1 = yearOf(to);
  const years: number[] = [];
  for (let y = y0; y <= y1; y++) years.push(y);
  const win = (y: number) => [Math.max(from, serialOf(y, 1, 1)), Math.min(to, serialOf(y, 12, 31))] as const;

  const revInc: number[] = [], share: number[] = [], shareRA: number[] = [];
  const exp: Record<string, number[]> = Object.fromEntries(heads.map((h) => [h, [] as number[]]));
  for (const y of years) {
    const [f, e] = win(y);
    const bk = data.bookings.filter((b) => sold(b) && inWin(b.month, f, e));
    revInc.push(bk.reduce((s, b) => (inChain(b, t) && b.depth > 0 ? s + b.rev : s), 0));
    let sh = 0, sr = 0;
    for (const b of bk) {
      if (inChain(b, t)) { sh += cumulativeShare(b, t, "share"); sr += cumulativeShare(b, t, "shareRA"); }
      if (sameCode(b.overrideEmp, t)) { sh += b.overrideShare; sr += b.overrideShareRA; }
    }
    share.push(sh);
    shareRA.push(sr);
    for (const h of heads) exp[h].push(expenseOf(data.exps, h, target, f, e) + (h === "Seat Cost" ? seatCostFor(target, data.seats, f, e) : 0));
  }
  const expTotal = years.map((_, i) => heads.reduce((s, h) => s + exp[h][i], 0));
  const ff = years.map((_, i) => share[i] - expTotal[i]);
  const pl = years.map((_, i) => shareRA[i] - expTotal[i]);
  const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
  const tExp: Record<string, number> = {};
  for (const h of heads) tExp[h] = sum(exp[h]);
  return {
    heads, years, revInc, share, shareRA, exp, expTotal, ff, pl,
    total: { revInc: sum(revInc), share: sum(share), shareRA: sum(shareRA), exp: tExp, expTotal: sum(expTotal), ff: sum(share) - sum(expTotal), pl: sum(shareRA) - sum(expTotal) },
  };
}

// ------------------------------------------------------------------ 3. Director-wise

export interface DirectorRow {
  director: string; // Name~Code
  revInc: number; share: number; shareRA: number; exp: number; ff: number; pl: number;
}

export function computeDirectorSummary(data: PnlData, directors: string[], from: number, to: number): DirectorRow[] {
  const bk = data.bookings.filter((b) => sold(b) && inWin(b.month, from, to));
  return directors.map((d) => {
    const dc = codeOf(d);
    let revInc = 0, share = 0, shareRA = 0;
    for (const b of bk) {
      const dr = sameCode(b.director, dc);
      if (dr) {
        revInc += b.rev;
        share += cumulativeShare(b, dc, "share");
        shareRA += cumulativeShare(b, dc, "shareRA");
      }
      if (sameCode(b.overrideEmp, dc)) { share += b.overrideShare; shareRA += b.overrideShareRA; }
      // an override paid out of a booking that sits under another Director's chain top is taken off that top
      const top = b.levels[4]?.emp ?? "";
      if (sameCode(top, dc) && !dr) { share -= b.overrideShare; shareRA -= b.overrideShareRA; }
    }
    const heads = pnlHeads(d, data.exps, from, to);
    let exp = 0;
    for (const h of heads) exp += expenseOf(data.exps, h, d, from, to) + (h === "Seat Cost" ? seatCostFor(d, data.seats, from, to) : 0);
    return { director: d, revInc, share, shareRA, exp, ff: share - exp, pl: shareRA - exp };
  });
}
