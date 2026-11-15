import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { projectionActuals, projectionRows, projectionYears, toProjRow, todayIso, todaySerial } from "@/lib/data";
import { METRIC_LABEL, MONTHS, projectionGrid, type Metric } from "@/lib/calc/projection";
import { fmtNum } from "@/lib/format";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const METRICS: Metric[] = ["revenue", "bookings", "manMonths"];

export default async function ProjectionPage({ searchParams }: { searchParams: Promise<{ year?: string; metric?: string; by?: string }> }) {
  const user = await requireUser(["master", "admin"]);
  const q = await searchParams;
  const thisYear = Number(todayIso().slice(0, 4));
  const years = await projectionYears();
  const year = Number(q.year) || (years.includes(thisYear) ? thisYear : years[years.length - 1] ?? thisYear);
  const metric: Metric = METRICS.includes(q.metric as Metric) ? (q.metric as Metric) : "revenue";
  const by = q.by === "director" ? "director" : "emp";
  const [rows, actuals] = await Promise.all([projectionRows(year), projectionActuals()]);
  const g = projectionGrid(rows.map(toProjRow), actuals, year, metric, todaySerial(), by);
  const dec = metric === "manMonths" ? 1 : 0;
  const f = (v: number) => (Math.abs(v) < 0.005 ? "-" : fmtNum(Math.round(v * 10 ** dec) / 10 ** dec));
  const href = (o: Record<string, string>) => `/reports/projection?${new URLSearchParams({ year: String(year), metric, by, ...o }).toString()}`;
  const pctText = (p: number | null) => (p === null ? "" : `${Math.round(p * 100)}%`);
  const pctClass = (p: number | null) => (p === null ? "" : p >= 1 ? "text-green-700" : p >= 0.6 ? "text-amber-700" : "text-red-700");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="h1">Projection vs Actual — {year}</h1>
        {user.role === "master" && <Link className="btn ml-auto" href={`/admin/projection?year=${year}`}>Edit targets</Link>}
      </div>
      <p className="text-sm text-[var(--muted)]">
        Each yearly target is spread equally over the 12 months. Actuals are Live and Not Live bookings by the booking&apos;s employee and booking month
        (DirectorRevenue, count), and man-months from the Emp periods of Sales staff. <b>YTD</b> runs to {g.asOfMonth ? MONTHS[g.asOfMonth - 1] : "—"}.
      </p>

      <div className="card flex flex-wrap items-center gap-4">
        <div className="flex gap-1">
          {years.length ? years.map((y) => <Link key={y} href={href({ year: String(y) })} className={`btn ${y === year ? "btn-primary" : ""}`}>{y}</Link>) : <span className="text-sm text-[var(--muted)]">No targets saved yet.</span>}
        </div>
        <div className="flex gap-1">
          {METRICS.map((m) => <Link key={m} href={href({ metric: m })} className={`btn ${m === metric ? "btn-primary" : ""}`}>{METRIC_LABEL[m]}</Link>)}
        </div>
        <div className="flex gap-1">
          <Link href={href({ by: "emp" })} className={`btn ${by === "emp" ? "btn-primary" : ""}`}>By employee</Link>
          <Link href={href({ by: "director" })} className={`btn ${by === "director" ? "btn-primary" : ""}`}>By Director</Link>
        </div>
      </div>

      <div className="card overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th>{by === "emp" ? "Employee" : "Director"}</th>
              {by === "emp" && <th>Director</th>}
              <th className="text-right">Year target</th><th className="text-right">Per month</th>
              {MONTHS.map((m) => <th key={m} className="text-right">{m}</th>)}
              <th className="text-right">YTD actual</th><th className="text-right">YTD target</th><th className="text-right">Achieved</th>
            </tr>
          </thead>
          <tbody>
            <Line l={g.total} by={by} f={f} pctText={pctText} pctClass={pctClass} bold />
            {g.lines.filter((l) => l.annual > 0 || l.ytdActual > 0).map((l) => <Line key={l.key} l={l} by={by} f={f} pctText={pctText} pctClass={pctClass} />)}
            <tr className="text-[var(--muted)]">
              <td colSpan={by === "emp" ? 4 : 3}>Not in the projection (everyone else)</td>
              {g.unprojected.map((v, i) => <td key={i} className="text-right">{f(v)}</td>)}
              <td className="text-right">{f(g.unprojected.slice(0, g.asOfMonth).reduce((s, v) => s + v, 0))}</td><td></td><td></td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Line({ l, by, f, pctText, pctClass, bold }: { l: ReturnType<typeof projectionGrid>["lines"][number]; by: string; f: (v: number) => string; pctText: (p: number | null) => string; pctClass: (p: number | null) => string; bold?: boolean }) {
  return (
    <tr className={bold ? "border-b-2 border-slate-700 bg-slate-50 font-bold" : ""}>
      <td className="whitespace-nowrap">{l.name.split("~")[0]}{l.remarks ? <span className="text-xs text-[var(--muted)]"> ({l.remarks})</span> : ""}</td>
      {by === "emp" && <td className="whitespace-nowrap text-xs text-[var(--muted)]">{l.director.split("~")[0]}</td>}
      <td className="text-right">{f(l.annual)}</td><td className="text-right">{f(l.monthly)}</td>
      {l.actual.map((v, i) => <td key={i} className="text-right">{f(v)}</td>)}
      <td className="text-right">{f(l.ytdActual)}</td><td className="text-right">{f(l.ytdProjected)}</td>
      <td className={`text-right font-semibold ${pctClass(l.pct)}`}>{pctText(l.pct)}</td>
    </tr>
  );
}
