// Projection vs Actual. A projection row is a yearly target for one employee (man-months, booking count, DirectorRevenue);
// it is spread equally over the 12 months. Actuals come from the bookings (by the booking's Emp) and the Emp periods.
import { serialOf } from "./pnl";

export type Metric = "revenue" | "bookings" | "manMonths";
export const METRIC_LABEL: Record<Metric, string> = { revenue: "DirectorRevenue (Rs)", bookings: "Booking count", manMonths: "Man-months" };
export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export interface ProjRow { empCode: string; manMonths: number; bkgCount: number; revenue: number; remarks: string | null }
export interface PersonInfo { name: string; director: string }
export interface ProjActuals {
  bookings: { empCode: string; month: number; rev: number }[]; // sold (Live / Not Live) bookings only; month = BkgMonth serial
  periods: { code: string; from: number; to: number; sales: boolean }[]; // Emp periods (to = today for open ones)
  people: Map<string, PersonInfo>; // by lower-case code
}

export interface ProjLine {
  key: string; name: string; director: string; remarks: string | null;
  annual: number; monthly: number;
  actual: number[]; // 12 months
  ytdActual: number; ytdProjected: number; pct: number | null; // pct of YTD projection achieved
}
export interface ProjGrid { year: number; metric: Metric; asOfMonth: number; lines: ProjLine[]; total: ProjLine; unprojected: number[] }

const annualOf = (r: ProjRow, m: Metric) => (m === "revenue" ? r.revenue : m === "bookings" ? r.bkgCount : r.manMonths);

/** Man-months of one employee in a month: days employed in that month / 365 x 12 (the Emp.ManMonths rule). */
function manMonthsIn(code: string, periods: ProjActuals["periods"], year: number, month: number): number {
  const ms = serialOf(year, month, 1);
  const me = serialOf(year, month + 1, 1) - 1;
  let days = 0;
  for (const p of periods) if (p.sales && p.code === code) days += Math.max(0, Math.min(p.to, me) - Math.max(p.from, ms - 1));
  return (days / 365) * 12;
}

export function projectionGrid(rows: ProjRow[], act: ProjActuals, year: number, metric: Metric, asOf: number, groupBy: "emp" | "director"): ProjGrid {
  const asOfYear = new Date(Date.UTC(1899, 11, 30) + asOf * 86400000).getUTCFullYear();
  const asOfMonth = asOfYear > year ? 12 : asOfYear < year ? 0 : new Date(Date.UTC(1899, 11, 30) + asOf * 86400000).getUTCMonth() + 1;

  const sums = new Map<string, number[]>();
  const per = (code: string) => {
    const k = code.toLowerCase();
    let a = sums.get(k);
    if (!a) {
      a = Array(12).fill(0);
      if (metric === "manMonths") for (let m = 1; m <= 12; m++) a[m - 1] = m <= asOfMonth ? manMonthsIn(k, act.periods.map((p) => ({ ...p, code: p.code.toLowerCase() })), year, m) : 0;
      sums.set(k, a);
    }
    return a;
  };
  if (metric !== "manMonths") {
    for (const b of act.bookings) {
      const y = new Date(Date.UTC(1899, 11, 30) + b.month * 86400000);
      if (y.getUTCFullYear() !== year) continue;
      const a = per(b.empCode);
      a[y.getUTCMonth()] += metric === "revenue" ? b.rev : 1;
    }
  }

  const line = (key: string, name: string, director: string, remarks: string | null, annual: number, actual: number[]): ProjLine => {
    const monthly = annual / 12;
    const ytdActual = actual.slice(0, asOfMonth).reduce((s, v) => s + v, 0);
    const ytdProjected = monthly * asOfMonth;
    return { key, name, director, remarks, annual, monthly, actual, ytdActual, ytdProjected, pct: ytdProjected > 0 ? ytdActual / ytdProjected : null };
  };

  let lines: ProjLine[];
  const used = new Set<string>();
  if (groupBy === "emp") {
    lines = rows.map((r) => {
      const k = r.empCode.toLowerCase();
      const info = act.people.get(k);
      // a code projected twice (e.g. a Channel line) shares one actual, so show it on the first line only
      const first = !used.has(k);
      used.add(k);
      return line(`${r.empCode}|${r.remarks ?? ""}`, info?.name ?? r.empCode, info?.director ?? "", r.remarks, annualOf(r, metric), first ? [...per(k)] : Array(12).fill(0));
    });
  } else {
    const byDir = new Map<string, { annual: number; actual: number[] }>();
    for (const r of rows) {
      const k = r.empCode.toLowerCase();
      const info = act.people.get(k);
      const d = info?.director || r.empCode;
      const g = byDir.get(d) ?? { annual: 0, actual: Array(12).fill(0) };
      g.annual += annualOf(r, metric);
      if (!used.has(k)) { used.add(k); per(k).forEach((v, i) => (g.actual[i] += v)); }
      byDir.set(d, g);
    }
    lines = [...byDir].sort((a, b) => a[0].localeCompare(b[0])).map(([d, g]) => line(d, d, d, null, g.annual, g.actual));
  }

  const tot = Array(12).fill(0);
  let annual = 0;
  for (const l of lines) { annual += l.annual; l.actual.forEach((v, i) => (tot[i] += v)); }
  const unprojected = Array(12).fill(0);
  for (const [k, a] of sums) if (!used.has(k)) a.forEach((v, i) => (unprojected[i] += v));
  return { year, metric, asOfMonth, lines, total: line("total", "Total", "", null, annual, tot), unprojected };
}
