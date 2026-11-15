import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { loadCore, projectionActuals, projectionRows, toProjRow, todayIso, todaySerial } from "@/lib/data";
import { computeDashboard, type Slice } from "@/lib/calc/dashboard";
import { projectionGrid } from "@/lib/calc/projection";
import { isoToSerial, num } from "@/lib/calc/excel";
import { fmtNum } from "@/lib/format";

export const dynamic = "force-dynamic";

const cr = (v: number) => (Math.abs(v) >= 1e7 ? `₹${(v / 1e7).toFixed(2)} cr` : Math.abs(v) >= 1e5 ? `₹${(v / 1e5).toFixed(1)} L` : `₹${fmtNum(Math.round(v))}`);

export default async function Dashboard({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  await requireUser(["master", "admin"]);
  const q = await searchParams;
  const today = todayIso();
  const fromIso = /^\d{4}-\d{2}-\d{2}$/.test(q.from ?? "") ? q.from! : `${today.slice(0, 4)}-01-01`;
  const toIso = /^\d{4}-\d{2}-\d{2}$/.test(q.to ?? "") ? q.to! : today;
  const from = isoToSerial(fromIso)!, to = isoToSerial(toIso)!;
  const year = Number(toIso.slice(0, 4));
  const { bk, exps } = await loadCore();
  const d = computeDashboard(
    bk.map((r) => ({
      status: String(r.FormStatus ?? ""), month: isoToSerial(r.BkgMonth as string) ?? 0, area: num(r.Area), rev: num(r.DirectorRevenue),
      director: String(r.Director ?? ""), branch: String(r.Branch ?? ""), project: String(r.Project ?? ""), pendDue: num(r.PendDue), billOS: num(r.BillOS),
    })),
    exps.map((r) => ({ date: isoToSerial(r.PayDate as string) ?? 0, head: String(r.Head ?? ""), expType: String(r.ExpType ?? ""), signed: num(r.SignedGross) })),
    from, to,
  );
  const [prows, actuals] = await Promise.all([projectionRows(year), projectionActuals()]);
  const pg = prows.length ? projectionGrid(prows.map(toProjRow), actuals, year, "revenue", Math.min(to, todaySerial()), "emp") : null;
  const maxRev = Math.max(1, ...d.months.map((m) => m.revenue)), maxBk = Math.max(1, ...d.months.map((m) => m.bookings)), maxCol = Math.max(1, ...d.months.map((m) => m.collections));

  const Tile = ({ label, value, sub }: { label: string; value: string; sub?: string }) => (
    <div className="card"><div className="text-xs uppercase tracking-wide text-[var(--muted)]">{label}</div><div className="mt-1 text-2xl font-semibold">{value}</div>{sub && <div className="text-xs text-[var(--muted)]">{sub}</div>}</div>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="h1">Dashboard</h1>
        <form className="ml-auto flex flex-wrap items-end gap-2" method="get">
          <div><label className="label" htmlFor="from">From</label><input id="from" name="from" type="date" className="input" defaultValue={fromIso} /></div>
          <div><label className="label" htmlFor="to">To</label><input id="to" name="to" type="date" className="input" defaultValue={toIso} /></div>
          <button className="btn btn-primary">Show</button>
        </form>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Tile label="Bookings (Live + Not Live)" value={fmtNum(d.bookings)} sub={`${fmtNum(Math.round(d.area))} sq ft`} />
        <Tile label="DirectorRevenue" value={cr(d.revenue)} />
        <Tile label="Collections (Recd From Client)" value={cr(d.collections)} />
        <Tile label="Paid expenses" value={cr(d.expenses)} />
        <Tile label="Cancellations" value={fmtNum(d.cancelled)} sub={`${(d.cancelRate * 100).toFixed(0)}% of bookings in the period`} />
        <Tile label="Revenue due (PendDue)" value={cr(d.pendDue)} sub="all live bookings, as of today" />
        <Tile label="Billed, not yet received" value={cr(d.billOS)} sub="all live bookings, as of today" />
        {pg && <Tile label={`Projection ${year} (YTD)`} value={pg.total.pct === null ? "-" : `${Math.round(pg.total.pct * 100)}%`} sub={`${cr(pg.total.ytdActual)} of ${cr(pg.total.ytdProjected)} target to date`} />}
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <Bars title="Bookings per month" data={d.months.map((m) => ({ label: m.label, v: m.bookings }))} max={maxBk} fmt={(v) => String(v)} />
        <Bars title="DirectorRevenue per month" data={d.months.map((m) => ({ label: m.label, v: m.revenue }))} max={maxRev} fmt={cr} />
        <Bars title="Collections per month" data={d.months.map((m) => ({ label: m.label, v: m.collections }))} max={maxCol} fmt={cr} />
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <SliceTable title="Top Directors (by revenue)" rows={d.topDirectors} />
        <SliceTable title="Branches" rows={d.branches} />
        <SliceTable title="Top projects" rows={d.projects} />
      </div>
      <p className="text-xs text-[var(--muted)]">
        More: <Link className="underline" href="/reports/projection">Projection vs Actual</Link> · <Link className="underline" href="/reports/pnl">P&amp;L</Link> · <Link className="underline" href="/reports/demand">Demand</Link>
      </p>
    </div>
  );
}

function Bars({ title, data, max, fmt }: { title: string; data: { label: string; v: number }[]; max: number; fmt: (v: number) => string }) {
  const w = 300, h = 110, n = Math.max(1, data.length), bw = Math.min(22, (w - 10) / n - 3);
  return (
    <div className="card">
      <h2 className="h2">{title}</h2>
      <svg viewBox={`0 0 ${w} ${h + 18}`} className="w-full" role="img" aria-label={title}>
        {data.map((p, i) => {
          const bh = Math.max(p.v > 0 ? 1.5 : 0, (Math.max(0, p.v) / max) * h);
          const x = 5 + i * ((w - 10) / n) + ((w - 10) / n - bw) / 2;
          return (
            <g key={i}>
              <rect x={x} y={h - bh} width={bw} height={bh} rx={2} fill="var(--brand)" opacity={0.85}><title>{`${p.label}: ${fmt(p.v)}`}</title></rect>
              {(n <= 14 || i % Math.ceil(n / 12) === 0) && <text x={x + bw / 2} y={h + 12} textAnchor="middle" fontSize="7" fill="currentColor" opacity={0.6}>{p.label}</text>}
            </g>
          );
        })}
        <line x1="0" y1={h} x2={w} y2={h} stroke="currentColor" opacity={0.2} />
      </svg>
    </div>
  );
}

function SliceTable({ title, rows }: { title: string; rows: Slice[] }) {
  return (
    <div className="card overflow-x-auto">
      <h2 className="h2">{title}</h2>
      <table className="table">
        <thead><tr><th>Name</th><th className="text-right">Bookings</th><th className="text-right">Revenue</th></tr></thead>
        <tbody>
          {rows.map((r) => <tr key={r.name}><td>{r.name}</td><td className="text-right">{fmtNum(r.count)}</td><td className="text-right">{cr(r.revenue)}</td></tr>)}
          {!rows.length && <tr><td colSpan={3} className="text-[var(--muted)]">No data.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
