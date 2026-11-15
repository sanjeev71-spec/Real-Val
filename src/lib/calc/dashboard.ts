// Dashboard numbers. All inputs are plain rows so this stays testable; the page feeds it from the computed Bkg and Exp.
export interface DashBooking {
  status: string; month: number; area: number; rev: number; director: string; branch: string; project: string; pendDue: number; billOS: number;
}
export interface DashExp { date: number; head: string; expType: string; signed: number }

export interface Slice { name: string; count: number; revenue: number }
export interface MonthPoint { key: string; label: string; bookings: number; revenue: number; collections: number }
export interface Dashboard {
  bookings: number; area: number; revenue: number; cancelled: number; cancelRate: number;
  collections: number; expenses: number; pendDue: number; billOS: number;
  months: MonthPoint[];
  topDirectors: Slice[]; branches: Slice[]; projects: Slice[];
}

const SOLD = new Set(["live", "not live"]);
const EPOCH = Date.UTC(1899, 11, 30);
const ymOf = (serial: number) => new Date(EPOCH + serial * 86400000).toISOString().slice(0, 7);
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function top(map: Map<string, Slice>, n: number): Slice[] {
  return [...map.values()].sort((a, b) => b.revenue - a.revenue || b.count - a.count).slice(0, n);
}

export function computeDashboard(bks: DashBooking[], exps: DashExp[], from: number, to: number): Dashboard {
  const inWin = (d: number) => d >= from && d <= to;
  const sold = bks.filter((b) => SOLD.has(b.status.trim().toLowerCase()) && inWin(b.month));
  const cancelled = bks.filter((b) => b.status.trim().toLowerCase() === "cancel" && inWin(b.month)).length;

  // month buckets over the window
  const months = new Map<string, MonthPoint>();
  for (let t = Date.UTC(new Date(EPOCH + from * 86400000).getUTCFullYear(), new Date(EPOCH + from * 86400000).getUTCMonth(), 1); t <= EPOCH + to * 86400000; ) {
    const d = new Date(t);
    const key = d.toISOString().slice(0, 7);
    months.set(key, { key, label: `${MON[d.getUTCMonth()]} ${String(d.getUTCFullYear()).slice(2)}`, bookings: 0, revenue: 0, collections: 0 });
    t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
  }
  const dirs = new Map<string, Slice>(), brs = new Map<string, Slice>(), prs = new Map<string, Slice>();
  const add = (m: Map<string, Slice>, name: string, rev: number) => {
    const k = name || "(none)";
    const s = m.get(k) ?? { name: k, count: 0, revenue: 0 };
    s.count++;
    s.revenue += rev;
    m.set(k, s);
  };
  let area = 0, revenue = 0;
  for (const b of sold) {
    area += b.area;
    revenue += b.rev;
    const mp = months.get(ymOf(b.month));
    if (mp) { mp.bookings++; mp.revenue += b.rev; }
    add(dirs, b.director.split("~")[0], b.rev);
    add(brs, b.branch, b.rev);
    add(prs, b.project, b.rev);
  }
  let collections = 0, expenses = 0;
  for (const e of exps) {
    if (!inWin(e.date)) continue;
    if (e.head.toLowerCase() === "recd from client") {
      collections += e.signed;
      const mp = months.get(ymOf(e.date));
      if (mp) mp.collections += e.signed;
    }
    if (e.expType === "Expense") expenses -= e.signed;
  }
  // receivables are "as of now": every live booking, not only the window
  let pendDue = 0, billOS = 0;
  for (const b of bks) if (SOLD.has(b.status.trim().toLowerCase())) { pendDue += b.pendDue; billOS += b.billOS; }
  const all = sold.length + cancelled;
  return {
    bookings: sold.length, area, revenue, cancelled, cancelRate: all ? cancelled / all : 0, collections, expenses, pendDue, billOS,
    months: [...months.values()], topDirectors: top(dirs, 10), branches: top(brs, 8), projects: top(prs, 10),
  };
}
