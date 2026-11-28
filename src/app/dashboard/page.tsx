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
import { ColumnChart, Donut, HBarChart, HGroupedChart, Tile, cr, short } from "@/components/DashCharts";
import { SEAT_CHARGED } from "@/lib/company";

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
  let qExp: number[] = []; // paid expenses per quarter (the Director P&L expenses)
  let plDirs: { director: string; ff: number; pl: number }[] = []; // F&F and P&L of each Director over the period
  if (official) {
    const [data, all] = await Promise.all([loadPnlData(), pnlDirectors()]);
    const list = scope.director ? all.filter((d) => d.toLowerCase() === scope.director.toLowerCase()) : all;
    const sumFor = (f: number, t: number) => {
      const rows = computeDirectorSummary(data, list, f, t);
      const seat = SEAT_CHARGED ? list.reduce((s, d) => s + seatCostFor(d, data.seats, f, t), 0) : 0;
      const a = (k: "revInc" | "share" | "shareRA" | "exp" | "ff" | "pl") => rows.reduce((s, r) => s + r[k], 0);
      return { rows, revInc: a("revInc"), share: a("share"), shareRA: a("shareRA"), seat, expense: a("exp") - seat, exp: a("exp"), ff: a("ff"), pl: a("pl") };
    };
    const whole = sumFor(from, to);
    pl = whole;
    plDirs = whole.rows.filter((r) => Math.round(r.ff) || Math.round(r.pl)).sort((a, b) => b.pl - a.pl);
    qExp = quarters.map((m) => sumFor(m.from, m.to).exp);
  }
  const inactive = new Set(c.directors.filter((d) => !d.active).map((d) => d.name.split("~")[0]));
  const isRed = (name: string) => inactive.has(name.split("~")[0]);
  // Director-wise DirectorRevenue over the whole period (top 8, the rest as Others)
  const dirRank = rank(sbk, "director", from, to, 1000).filter((r) => r.revenue > 0.5); // a share of the total: Directors with revenue only
  const dirSlices = [...dirRank.slice(0, 8).map((r) => ({ label: r.name, v: r.revenue, red: isRed(r.name) })),
    ...(dirRank.length > 8 ? [{ label: "Others", v: dirRank.slice(8).reduce((s, r) => s + r.revenue, 0), colour: "#94a3b8" }] : [])];
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

  // P&L tiles (Master), shown below the top charts
  const plSection = isMaster && (
        <section className="space-y-2">
          <h2 className="h2 !mb-0">P&amp;L {official ? "" : "(booking level)"}</h2>
          {pl ? (
            <div className="grid grid-cols-2 gap-2 md:grid-flow-col md:auto-cols-fr">
              <Tile label="F&F (ShareAmt - Paid Exp)" value={cr(pl.ff)} colour={pl.ff < 0 ? "#ef4444" : "#16a34a"} />
              <Tile label="P&L (RA - Paid Exp)" value={cr(pl.pl)} colour={pl.pl < 0 ? "#ef4444" : "#16a34a"} />
              <Tile label="DirectorRevenue + Incentives" value={cr(pl.revInc)} colour="#2563eb" />
              <Tile label="ShareAmt x RA%" value={cr(pl.shareRA)} colour="#f59e0b" />
              <Tile label={SEAT_CHARGED ? "Expense (excl. Seat Cost)" : "Paid Exp"} value={cr(pl.expense)} colour="#ec4899" />
              {SEAT_CHARGED && <Tile label="Seat Cost" value={cr(pl.seat)} colour="#06b6d4" />}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2 md:grid-flow-col md:auto-cols-fr">
              <Tile label="ShareAmt x RA%" value={cr(p.shareRA)} sub="booking level, before overrides" colour="#f59e0b" />
              <Tile label="Comm Paid (linked to these bookings)" value={cr(commPaid)} colour="#ec4899" />
              <Tile label="ShareAmt - Comm Paid" value={cr(p.share - commPaid)} colour={p.share - commPaid < 0 ? "#ef4444" : "#16a34a"} />
              <div className="card text-xs text-[var(--muted)]">F&amp;F and P&amp;L are per Director (all their expenses{SEAT_CHARGED ? " and seat cost" : ""}). For a Builder or Project only the booking-level figures are shown.</div>
            </div>
          )}
        </section>
  );

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

      <div className="grid grid-cols-2 gap-2 md:grid-flow-col md:auto-cols-fr">
        <Tile label="Bookings (Live + Not Live)" value={fmtNum(p.bookings)} sub={`${p.live} Live · ${p.notLive} Not Live · ${fmtNum(Math.round(p.area))} sq ft`} href={soldWin} colour="#2563eb" />
        <Tile label="DirectorRevenue" value={cr(p.revenue)} sub={p.area ? `₹${fmtNum(Math.round(p.revenue / p.area))} per sq ft` : undefined} href={soldWin} colour="#16a34a" />
        <Tile label="ShareAmt" value={cr(pl ? pl.share : p.share)} sub={pl ? "after overrides" : "booking level, before overrides"} colour="#f59e0b" />
        <Tile label="Cancellations" value={fmtNum(p.cancelled)} sub={`${(p.cancelRate * 100).toFixed(0)}% of bookings in the period`} href={linkOk ? `/bookings?status=Cancel&${win}${bkgQ}` : undefined} colour="#ef4444" />
        {proj && <Tile label={`Projection ${year} (YTD)`} value={proj.pct === null ? "-" : `${Math.round(proj.pct * 100)}%`} sub={`${cr(proj.ytdActual)} of ${cr(proj.ytdProjected)} target to date`} colour="#8b5cf6" />}
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Donut title="DirectorRevenue by Director (whole period)" fmt={cr} slices={dirSlices} centre={cr(p.revenue).replace("₹", "")} hrefOf={(l) => (l === "Others" ? undefined : drill("director")(l))}
          note={`${dirRank.length} Director${dirRank.length === 1 ? "" : "s"} with bookings in the period.${inactive.size ? " Red = inactive." : ""}`} />
        <HGroupedChart title="Bookings, DirectorRevenue and Expenses per quarter"
          series={[{ name: "DirectorRevenue", colour: "#16a34a" }, ...(qExp.length ? [{ name: "Paid Exp", colour: "#ec4899" }] : [])]}
          rows={p.months.map((m, i) => ({ label: m.label, badge: `${m.bookings} booking${m.bookings === 1 ? "" : "s"}`, values: [m.revenue, ...(qExp.length ? [qExp[i] ?? 0] : [])] })).filter((r, i, all) => r.values.some((v) => Math.abs(v) > 0.5) || p.months[i].bookings > 0 || all.slice(0, i).some((x) => x.values.some((v) => Math.abs(v) > 0.5)))}
          hrefOf={linkOk ? (l) => { const m = p.months.find((x) => x.label === l); return m ? `/bookings?sold=1&${qWin(m)}${bkgQ}` : undefined; } : undefined}
          note={qExp.length ? "Expenses counted in the quarter they are paid. Click a quarter to open its bookings." : "Click a quarter to open its bookings."} />
      </div>

      {plSection}

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {plDirs.length > 0
          ? <HGroupedChart title="F&F and P&L by Director" fmt={short}
              series={[{ name: "F&F (ShareAmt − Paid Exp)", colour: "#2563eb" }, { name: "P&L (ShareAmt × RA% − Paid Exp)", colour: "#f59e0b" }]}
              rows={plDirs.map((d) => ({ label: d.director.split("~")[0], red: isRed(d.director), values: [d.ff, d.pl] }))}
              hrefOf={(l) => drill("director")(l)}
              note={`Losses grow to the left of the line, in red.${inactive.size ? " Red name = inactive Director." : ""}`} />
          : <ColumnChart title="ShareAmt per quarter" data={p.months.map((m) => ({ label: m.label, v: m.share }))} colour="#f59e0b" note="Booking level, before overrides." />}
        <Donut title="Booking status" slices={[{ label: "Live", v: p.live, colour: "#16a34a" }, { label: "Not Live", v: p.notLive, colour: "#f59e0b" }, { label: "Cancelled", v: p.cancelled, colour: "#ef4444" }]} centre={`${p.bookings + p.cancelled}`} note="Bookings of the period by form status." />
      </div>

      <section className="space-y-2">
        <h2 className="h2 !mb-0">Ranking by Director, Builder, Project and Branch</h2>
        <p className="text-xs text-[var(--muted)]">Bar = DirectorRevenue; after it: bookings | area | ShareAmt (booking level, before overrides). Click a bar to narrow the dashboard to it.</p>
        <div className="grid grid-cols-1 gap-3">
          {(Object.keys(BY_LABEL) as By[]).map((by) => (
            <HBarChart key={by} wide title={`${BY_LABEL[by]}s by DirectorRevenue`} hrefOf={drill(by)} isRed={by === "director" ? isRed : undefined}
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
