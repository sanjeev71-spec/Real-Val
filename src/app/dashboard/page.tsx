import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { loadPnlData, pnlDirectors, projectionActuals, projectionRows, toProjRow, todaySerial } from "@/lib/data";
import { dashContext } from "@/lib/dashPage";
import { BY_LABEL, inScope, isScoped, perf, quarterBuckets, rank, type By } from "@/lib/calc/dashScope";
import { computeDirectorSummary, seatCostFor } from "@/lib/calc/pnl";
import { projectionGrid } from "@/lib/calc/projection";
import { serialToIso } from "@/lib/calc/excel";
import { fmtNum } from "@/lib/format";
import DashTabs from "@/components/DashTabs";
import DashFilters from "@/components/DashFilters";
import { ColumnChart, Donut, GroupedChart, HBarChart, Tile, cr } from "@/components/DashCharts";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export default async function Dashboard({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireUser(["master", "admin"]);
  const c = await dashContext(await searchParams);
  const { bks, exps, scope, from, to, fromIso, toIso } = c;
  const isMaster = user.role === "master";
  const scoped = isScoped(scope);
  const sbk = bks.filter((b) => inScope(b, scope));
  const p = perf(sbk, from, to);
  const quarters = quarterBuckets(from, to);

  // ---- P&L: the Director-wise P&L when the view is the company or one Director; booking level when narrowed to a Builder / Project
  const official = isMaster && !scope.builder && !scope.project;
  let pl: { revInc: number; share: number; shareRA: number; seat: number; expense: number; ff: number; pl: number } | null = null;
  let plQuarters: { label: string; ff: number; pl: number }[] = [];
  if (official) {
    const [data, all] = await Promise.all([loadPnlData(), pnlDirectors()]);
    const list = scope.director ? all.filter((d) => d.toLowerCase() === scope.director.toLowerCase()) : all;
    const sumFor = (f: number, t: number) => {
      const rows = computeDirectorSummary(data, list, f, t);
      const seat = list.reduce((s, d) => s + seatCostFor(d, data.seats, f, t), 0);
      const a = (k: "revInc" | "share" | "shareRA" | "exp" | "ff" | "pl") => rows.reduce((s, r) => s + r[k], 0);
      return { revInc: a("revInc"), share: a("share"), shareRA: a("shareRA"), seat, expense: a("exp") - seat, ff: a("ff"), pl: a("pl") };
    };
    pl = sumFor(from, to);
    plQuarters = quarters.map((m) => { const r = sumFor(m.from, m.to); return { label: m.label, ff: r.ff, pl: r.pl }; });
  }
  const commPaid = isMaster && !official
    ? (() => {
        const ids = new Set(sbk.map((b) => b.id.toLowerCase()));
        return -exps.reduce((s, e) => (e.head.toLowerCase() === "comm paid" && e.date >= from && e.date <= to && ids.has(e.bkgId.toLowerCase()) ? s + e.signed : s), 0);
      })()
    : 0;

  // ---- projection (company view only)
  const year = Number(toIso.slice(0, 4));
  let proj: { pct: number | null; ytdActual: number; ytdProjected: number } | null = null;
  if (!scoped) {
    const [prows, actuals] = await Promise.all([projectionRows(year), projectionActuals()]);
    if (prows.length) proj = projectionGrid(prows.map(toProjRow), actuals, year, "revenue", Math.min(to, todaySerial()), "emp").total;
  }

  // ---- rankings: every dimension on this page; a click narrows the dashboard to that Director / Builder / Project
  const nameMap = new Map(bks.map((b) => [b.director.split("~")[0], b.director]));
  const drill = (by: By) => (name: string) => {
    if (name === "(none)") return undefined;
    if (by === "director") return c.href("/dashboard", { director: nameMap.get(name) ?? "" });
    if (by === "builder") return c.href("/dashboard", { builder: name, project: "" });
    if (by === "project") return c.href("/dashboard", { project: name });
    return undefined;
  };
  const win = `from=${fromIso}&to=${toIso}`;
  const bkgQ = `${scope.director ? `&Director=${encodeURIComponent(scope.director)}` : ""}${scope.project ? `&Project=${encodeURIComponent(scope.project)}` : ""}`;
  const linkOk = !scope.builder; // the Bkg list has no Builder filter
  const soldWin = linkOk ? `/bookings?sold=1&${win}${bkgQ}` : undefined;
  const qWin = (m: { from: number; to: number }) => `from=${serialToIso(m.from)}&to=${serialToIso(m.to)}`;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start gap-3">
        <div>
          <h1 className="h1">Dashboard</h1>
          <DashTabs active="perf" href={c.href} />
        </div>
        <div className="ml-auto"><DashFilters from={fromIso} to={toIso} director={scope.director} builder={scope.builder} project={scope.project} directors={c.directors} builders={c.builders} projects={c.projects} /></div>
      </div>
      <p className="text-sm text-[var(--muted)]">Showing <b className="text-[var(--ink)]">{c.label}</b> · bookings of {fromIso.split("-").reverse().join("-")} to {toIso.split("-").reverse().join("-")}</p>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Tile label="Bookings (Live + Not Live)" value={fmtNum(p.bookings)} sub={`${p.live} Live · ${p.notLive} Not Live · ${fmtNum(Math.round(p.area))} sq ft`} href={soldWin} colour="#2563eb" />
        <Tile label="DirectorRevenue" value={cr(p.revenue)} sub={p.area ? `₹${fmtNum(Math.round(p.revenue / p.area))} per sq ft` : undefined} href={soldWin} colour="#16a34a" />
        <Tile label="ShareAmt" value={cr(pl ? pl.share : p.share)} sub={pl ? "after overrides" : "booking level, before overrides"} colour="#f59e0b" />
        <Tile label="Cancellations" value={fmtNum(p.cancelled)} sub={`${(p.cancelRate * 100).toFixed(0)}% of bookings in the period`} href={linkOk ? `/bookings?status=Cancel&${win}${bkgQ}` : undefined} colour="#ef4444" />
        {proj && <Tile label={`Projection ${year} (YTD)`} value={proj.pct === null ? "-" : `${Math.round(proj.pct * 100)}%`} sub={`${cr(proj.ytdActual)} of ${cr(proj.ytdProjected)} target to date`} colour="#8b5cf6" />}
      </div>

      {isMaster && (
        <section className="space-y-2">
          <h2 className="h2 !mb-0">P&amp;L {official ? "" : "(booking level)"}</h2>
          {pl ? (
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Tile label="F&F (ShareAmt - Paid Exp)" value={cr(pl.ff)} colour={pl.ff < 0 ? "#ef4444" : "#16a34a"} />
              <Tile label="P&L (RA - Paid Exp)" value={cr(pl.pl)} colour={pl.pl < 0 ? "#ef4444" : "#16a34a"} />
              <Tile label="DirectorRevenue + Incentives" value={cr(pl.revInc)} colour="#2563eb" />
              <Tile label="ShareAmt x RA%" value={cr(pl.shareRA)} colour="#f59e0b" />
              <Tile label="Expense (excl. Seat Cost)" value={cr(pl.expense)} colour="#ec4899" />
              <Tile label="Seat Cost" value={cr(pl.seat)} colour="#06b6d4" />
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Tile label="ShareAmt x RA%" value={cr(p.shareRA)} sub="booking level, before overrides" colour="#f59e0b" />
              <Tile label="Comm Paid (linked to these bookings)" value={cr(commPaid)} colour="#ec4899" />
              <Tile label="ShareAmt - Comm Paid" value={cr(p.share - commPaid)} colour={p.share - commPaid < 0 ? "#ef4444" : "#16a34a"} />
              <div className="card text-xs text-[var(--muted)]">F&amp;F and P&amp;L are per Director (all their expenses and seat cost). For a Builder or Project only the booking-level figures are shown.</div>
            </div>
          )}
        </section>
      )}

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <ColumnChart title="Bookings per quarter" data={p.months.map((m) => ({ label: m.label, v: m.bookings, href: linkOk ? `/bookings?sold=1&${qWin(m)}${bkgQ}` : undefined }))} colour="#2563eb" fmt={(v) => String(v)} />
        <ColumnChart title="DirectorRevenue per quarter" data={p.months.map((m) => ({ label: m.label, v: m.revenue }))} colour="#16a34a" />
        {plQuarters.length > 0
          ? <GroupedChart title="F&F and P&L per quarter" labels={plQuarters.map((m) => m.label)} series={[{ name: "F&F", colour: "#2563eb", values: plQuarters.map((m) => m.ff) }, { name: "P&L", colour: "#f59e0b", values: plQuarters.map((m) => m.pl) }]} note="Expenses and seat cost counted in the quarter they fall in." />
          : <ColumnChart title="ShareAmt per quarter" data={p.months.map((m) => ({ label: m.label, v: m.share }))} colour="#f59e0b" note="Booking level, before overrides." />}
        <Donut title="Booking status" slices={[{ label: "Live", v: p.live, colour: "#16a34a" }, { label: "Not Live", v: p.notLive, colour: "#f59e0b" }, { label: "Cancelled", v: p.cancelled, colour: "#ef4444" }]} centre={`${p.bookings + p.cancelled}`} note="Bookings of the period by form status." />
      </div>

      <section className="space-y-2">
        <h2 className="h2 !mb-0">Ranking by Director, Builder, Project and Branch</h2>
        <p className="text-xs text-[var(--muted)]">Bar = DirectorRevenue; after it: bookings | area | ShareAmt (booking level, before overrides). Click a bar to narrow the dashboard to it.</p>
        <div className="grid grid-cols-1 gap-3">
          {(Object.keys(BY_LABEL) as By[]).map((by) => (
            <HBarChart key={by} wide title={`${BY_LABEL[by]}s by DirectorRevenue`} hrefOf={drill(by)}
              rows={rank(sbk, by, from, to, 12).map((r) => ({ name: r.name, v: r.revenue, extra: `${fmtNum(r.count)} bkgs | ${fmtNum(Math.round(r.area))} sq ft | ShareAmt ${cr(r.share)}` }))} />
          ))}
        </div>
      </section>
      <p className="text-xs text-[var(--muted)]">
        More: <Link className="underline" href="/reports/projection">Projection vs Actual</Link>{isMaster && <> · <Link className="underline" href="/reports/pnl">P&amp;L</Link></>} · <Link className="underline" href="/reports/demand">Demand</Link>
      </p>
    </div>
  );
}
