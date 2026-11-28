import Link from "next/link";
import { inArray } from "drizzle-orm";
import { requireUser } from "@/lib/auth";
import { getDb, schema as s } from "@/lib/db";
import { loadCore, loadPnlData, pnlDirectors, projectionActuals, projectionRows, toProjRow, todaySerial } from "@/lib/data";
import { dashContext } from "@/lib/dashPage";
import { BY_LABEL, inScope, isScoped, isSold, perf, quarterBuckets, rank, stageOf, type By } from "@/lib/calc/dashScope";
import { computeDirectorSummary, seatCostFor } from "@/lib/calc/pnl";
import { projectionGrid } from "@/lib/calc/projection";
import { findExceptions } from "@/lib/calc/exceptions";
import { serialToIso } from "@/lib/calc/excel";
import { fmtNum } from "@/lib/format";
import DashTabs from "@/components/DashTabs";
import DashFilters from "@/components/DashFilters";
import { AlertStrip, ColumnChart, Donut, HBarChart, HGroupedChart, LineChart, Tile, change, cr, short } from "@/components/DashCharts";
import { COMPANY, SEAT_CHARGED } from "@/lib/company";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const NON_CASH = new Set(["billing", "noc"]); // billed / NOC entries are not money in or out

export default async function Dashboard({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireUser(["master", "admin"]);
  const q = await searchParams;
  const c = await dashContext(q);
  const { bks, exps, scope, from, to, fromIso, toIso } = c;
  const isMaster = user.role === "master";
  const scoped = isScoped(scope);
  const sbk = bks.filter((b) => inScope(b, scope));
  const p = perf(sbk, from, to);
  const quarters = quarterBuckets(from, to);
  const today = todaySerial();

  // ---- the same length of time just before the chosen period, for the ▲ / ▼ on the tiles
  const len = to - from + 1, pFrom = from - len, pTo = from - 1;
  const pp = perf(sbk, pFrom, pTo);
  const prevLabel = `vs ${serialToIso(pFrom)!.split("-").reverse().join("-")} to ${serialToIso(pTo)!.split("-").reverse().join("-")} (the same length of time just before)`;

  // ---- P&L: the Director-wise P&L when the view is the company or one Director; booking level when narrowed to a Builder / Project
  const official = isMaster && !scope.builder && !scope.project;
  type PlSum = { revInc: number; share: number; shareRA: number; seat: number; expense: number; exp: number; ff: number; pl: number };
  let pl: PlSum | null = null, prevPl: PlSum | null = null;
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
    prevPl = sumFor(pFrom, pTo);
    plDirs = whole.rows.filter((r) => Math.round(r.ff) || Math.round(r.pl)).sort((a, b) => b.pl - a.pl);
    qExp = quarters.map((m) => sumFor(m.from, m.to).exp);
  }
  const inactive = new Set(c.directors.filter((d) => !d.active).map((d) => d.name.split("~")[0]));
  const isRed = (name: string) => inactive.has(name.split("~")[0]);
  // Director-wise DirectorRevenue over the whole period (top 8, the rest as Others)
  const dirRank = rank(sbk, "director", from, to, 1000).filter((r) => r.revenue > 0.5); // a share of the total: Directors with revenue only
  const dirSlices = [...dirRank.slice(0, 8).map((r) => ({ label: r.name, v: r.revenue, red: isRed(r.name) })),
    ...(dirRank.length > 8 ? [{ label: "Others", v: dirRank.slice(8).reduce((s, r) => s + r.revenue, 0), colour: "#94a3b8" }] : [])];
  const scopedIds = new Set(sbk.map((b) => b.id.toLowerCase()));
  const commPaid = isMaster && !official
    ? -exps.reduce((s, e) => (e.head.toLowerCase() === "comm paid" && e.date >= from && e.date <= to && scopedIds.has(e.bkgId.toLowerCase()) ? s + e.signed : s), 0)
    : 0;

  // ---- average rate and the age of bookings whose RA is not closed yet (the date RA closes is not recorded)
  const rate = p.area ? p.revenue / p.area : 0, prevRate = pp.area ? pp.revenue / pp.area : 0;
  const openRa = sbk.filter((b) => isSold(b.status) && b.month >= from && b.month <= to && b.month > 0 && stageOf(b.rcra, b.raPct) !== "RA Close");
  const raAge = openRa.length ? openRa.reduce((s, b) => s + Math.max(0, today - b.month), 0) / openRa.length : 0;

  // ---- projection: the company total for the tile, and Target vs Achieved per Director (company or one Director)
  const year = Number(toIso.slice(0, 4));
  let proj: { pct: number | null; ytdActual: number; ytdProjected: number } | null = null;
  let target: { label: string; badge: string; red: boolean; values: number[] }[] = [];
  if (!scope.builder && !scope.project) {
    const [prows, actuals] = await Promise.all([projectionRows(year), projectionActuals()]);
    if (prows.length) {
      const asOf = Math.min(to, today);
      if (!scoped) proj = projectionGrid(prows.map(toProjRow), actuals, year, "revenue", asOf, "emp").total;
      const code = (n: string) => (n.split("~")[1] ?? n).toLowerCase();
      target = projectionGrid(prows.map(toProjRow), actuals, year, "revenue", asOf, "director").lines
        .filter((l) => (l.ytdProjected > 0.5 || l.ytdActual > 0.5) && (!scope.director || code(l.name) === code(scope.director)))
        .sort((a, b) => b.ytdProjected - a.ytdProjected)
        .slice(0, 10)
        .map((l) => ({ label: l.name.split("~")[0], badge: l.pct === null ? "no target" : `${Math.round(l.pct * 100)}% achieved`, red: isRed(l.name), values: [l.ytdProjected, l.ytdActual] }));
    }
  }

  // ---- cash in vs cash out by month (Exp entries; for a Director / Builder / Project only those linked to its bookings)
  const months: { label: string; from: number; to: number }[] = [];
  for (let d = new Date(`${serialToIso(from)!.slice(0, 7)}-01T00:00:00Z`); ; d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1))) {
    const mf = Math.round((d.getTime() - Date.UTC(1899, 11, 30)) / 86400000);
    if (mf > to) break;
    const mt = Math.round((Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1) - Date.UTC(1899, 11, 30)) / 86400000) - 1;
    months.push({ label: `${MON[d.getUTCMonth()]} ${String(d.getUTCFullYear()).slice(2)}`, from: mf, to: mt });
  }
  const cashIn = months.map(() => 0), cashOut = months.map(() => 0);
  for (const e of exps) {
    if (e.date < from || e.date > to || NON_CASH.has(e.mode.trim().toLowerCase())) continue;
    if (scoped && !scopedIds.has(e.bkgId.toLowerCase())) continue;
    const i = months.findIndex((m) => e.date >= m.from && e.date <= m.to);
    if (i < 0) continue;
    if (e.signed > 0) cashIn[i] += e.signed; else cashOut[i] -= e.signed;
  }
  const firstCash = cashIn.findIndex((v, i) => v > 0.5 || cashOut[i] > 0.5);
  const cm = firstCash < 0 ? [] : months.map((m, i) => ({ ...m, in: cashIn[i], out: cashOut[i] })).slice(firstCash);

  // ---- the biggest bookings of the period
  const top5 = sbk.filter((b) => isSold(b.status) && b.month >= from && b.month <= to).sort((a, b) => b.rev - a.rev).slice(0, 5);

  // ---- what needs attention
  const db = await getDb();
  const [core, emps, heads, waitingScd, waitingChanges] = await Promise.all([
    loadCore(),
    db.selectDistinct({ emp: s.employees.emp }).from(s.employees),
    db.select({ head: s.expHeads.head }).from(s.expHeads),
    db.select({ id: s.submissions.id }).from(s.submissions).where(inArray(s.submissions.status, isMaster ? ["pending_admin", "pending_master"] : ["pending_admin"])),
    isMaster ? db.select({ id: s.changeRequests.id }).from(s.changeRequests).where(inArray(s.changeRequests.status, ["pending"])) : Promise.resolve([]),
  ]);
  const exceptions = findExceptions(core.bk as never, core.exps as never, new Set(emps.map((e) => e.emp)), new Set(heads.map((h) => h.head.toLowerCase()))).reduce((a, g) => a + g.count, 0);
  const noSlab = sbk.filter((b) => isSold(b.status) && b.noSlab).length;

  // ---- rankings: one card, a tab per dimension; a click narrows the dashboard to that Director / Builder / Project
  const rk: By = (["director", "builder", "project", "branch"] as By[]).includes(q.rk as By) ? (q.rk as By) : "director";
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
  const d = (now: number, before: number) => change(now, before);

  // P&L tiles (Master)
  const plSection = isMaster && (
    <section className="space-y-2">
      <h2 className="h2 !mb-0">P&amp;L {official ? "" : "(booking level)"}</h2>
      {pl ? (
        <div className="grid grid-cols-2 gap-2 md:grid-flow-col md:auto-cols-fr">
          <Tile label="F&F (ShareAmt - Paid Exp)" value={cr(pl.ff)} colour={pl.ff < 0 ? "#ef4444" : "#16a34a"} delta={prevPl ? d(pl.ff, prevPl.ff) : undefined} deltaLabel={prevLabel} />
          <Tile label="P&L (RA - Paid Exp)" value={cr(pl.pl)} colour={pl.pl < 0 ? "#ef4444" : "#16a34a"} delta={prevPl ? d(pl.pl, prevPl.pl) : undefined} deltaLabel={prevLabel} />
          <Tile label="DirectorRevenue + Incentives" value={cr(pl.revInc)} colour="#2563eb" delta={prevPl ? d(pl.revInc, prevPl.revInc) : undefined} deltaLabel={prevLabel} />
          <Tile label="ShareAmt x RA%" value={cr(pl.shareRA)} colour="#f59e0b" delta={prevPl ? d(pl.shareRA, prevPl.shareRA) : undefined} deltaLabel={prevLabel} />
          <Tile label={SEAT_CHARGED ? "Expense (excl. Seat Cost)" : "Paid Exp"} value={cr(pl.expense)} colour="#ec4899" delta={prevPl ? d(pl.expense, prevPl.expense) : undefined} lowerIsBetter deltaLabel={prevLabel} />
          {SEAT_CHARGED && <Tile label="Seat Cost" value={cr(pl.seat)} colour="#06b6d4" />}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2 md:grid-flow-col md:auto-cols-fr">
          <Tile label="ShareAmt x RA%" value={cr(p.shareRA)} sub="booking level, before overrides" colour="#f59e0b" delta={d(p.shareRA, pp.shareRA)} deltaLabel={prevLabel} />
          <Tile label="Comm Paid (linked to these bookings)" value={cr(commPaid)} colour="#ec4899" />
          <Tile label="ShareAmt - Comm Paid" value={cr(p.share - commPaid)} colour={p.share - commPaid < 0 ? "#ef4444" : "#16a34a"} />
          <div className="card text-xs text-[var(--muted)]">F&amp;F and P&amp;L are per Director (all their expenses{SEAT_CHARGED ? " and seat cost" : ""}). For a Builder or Project only the booking-level figures are shown.</div>
        </div>
      )}
    </section>
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start gap-3">
        <div>
          <h1 className="h1">Dashboard</h1>
          <DashTabs active="perf" href={c.href} />
        </div>
        <div className="ml-auto"><DashFilters from={fromIso} to={toIso} director={scope.director} builder={scope.builder} project={scope.project} directors={c.directors} builders={c.builders} projects={c.projects} /></div>
      </div>
      <p className="text-sm text-[var(--muted)]">
        Showing <b className="text-[var(--ink)]">{c.label}</b> · bookings of {fromIso.split("-").reverse().join("-")} to {toIso.split("-").reverse().join("-")}
        <span className="ml-1 text-xs">· ▲ / ▼ = change against the same length of time just before</span>
      </p>

      <AlertStrip items={[
        { label: `sold booking${noSlab === 1 ? "" : "s"} without a DSlab (no price list)`, count: noSlab, href: isMaster ? "/admin/masters" : undefined, tone: "red" },
        { label: "data exceptions", count: exceptions, href: "/reports/exceptions", tone: "amber" },
        { label: `${COMPANY.form} form${waitingScd.length === 1 ? "" : "s"} waiting for approval`, count: waitingScd.length, href: "/submissions", tone: "blue" },
        { label: "Exp / Emp / Bkg changes waiting for you", count: waitingChanges.length, href: "/changes", tone: "blue" },
      ]} />

      <div className="grid grid-cols-2 gap-2 md:grid-flow-col md:auto-cols-fr">
        <Tile label="Bookings (Live + Not Live)" value={fmtNum(p.bookings)} sub={`${p.live} Live · ${p.notLive} Not Live · ${fmtNum(Math.round(p.area))} sq ft`} href={soldWin} colour="#2563eb" delta={d(p.bookings, pp.bookings)} deltaLabel={prevLabel} />
        <Tile label="DirectorRevenue" value={cr(p.revenue)} sub={`${dirRank.length} Director${dirRank.length === 1 ? "" : "s"} contributing`} href={soldWin} colour="#16a34a" delta={d(p.revenue, pp.revenue)} deltaLabel={prevLabel} />
        <Tile label="Avg DirectorRevenue / sq ft" value={rate ? `₹${fmtNum(Math.round(rate))}` : "-"} sub={`on ${fmtNum(Math.round(p.area))} sq ft sold`} colour="#0d9488" delta={rate && prevRate ? d(rate, prevRate) : undefined} deltaLabel={prevLabel} />
        <Tile label="ShareAmt" value={cr(pl ? pl.share : p.share)} sub={pl ? "after overrides" : "booking level, before overrides"} colour="#f59e0b" delta={pl && prevPl ? d(pl.share, prevPl.share) : d(p.share, pp.share)} deltaLabel={prevLabel} />
        <Tile label="Cancellations" value={fmtNum(p.cancelled)} sub={`${(p.cancelRate * 100).toFixed(0)}% of bookings in the period`} href={linkOk ? `/bookings?status=Cancel&${win}${bkgQ}` : undefined} colour="#ef4444" delta={d(p.cancelled, pp.cancelled)} lowerIsBetter deltaLabel={prevLabel} />
        <Tile label="RA not closed: avg age" value={openRa.length ? `${Math.round(raAge)} days` : "-"} sub={`${openRa.length} sold booking${openRa.length === 1 ? "" : "s"} of the period still open`} href="/dashboard/receivables" colour="#f97316" />
        {proj && <Tile label={`Projection ${year} (YTD)`} value={proj.pct === null ? "-" : `${Math.round(proj.pct * 100)}%`} sub={`${cr(proj.ytdActual)} of ${cr(proj.ytdProjected)} target to date`} href="/reports/projection" colour="#8b5cf6" />}
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <Donut title="DirectorRevenue by Director" fmt={cr} slices={dirSlices} centre={cr(p.revenue).replace("₹", "")} hrefOf={(l) => (l === "Others" ? undefined : drill("director")(l))}
          note={`Whole period chosen.${inactive.size ? " Red = inactive." : ""} Click a name to look at that Director.`} />
        <HGroupedChart title="Bookings, DirectorRevenue & Expenses per quarter"
          series={[{ name: "DirectorRevenue", colour: "#16a34a" }, ...(qExp.length ? [{ name: "Paid Exp", colour: "#ec4899" }] : [])]}
          rows={p.months.map((m, i) => ({ label: m.label, badge: `${m.bookings} booking${m.bookings === 1 ? "" : "s"}`, values: [m.revenue, ...(qExp.length ? [qExp[i] ?? 0] : [])] })).filter((r, i, all) => r.values.some((v) => Math.abs(v) > 0.5) || p.months[i].bookings > 0 || all.slice(0, i).some((x) => x.values.some((v) => Math.abs(v) > 0.5)))}
          hrefOf={linkOk ? (l) => { const m = p.months.find((x) => x.label === l); return m ? `/bookings?sold=1&${qWin(m)}${bkgQ}` : undefined; } : undefined}
          note={qExp.length ? "Expenses in the quarter they are paid. Click a quarter for its bookings." : "Click a quarter for its bookings."} />
        {target.length > 0
          ? <HGroupedChart title={`Target vs achieved ${year} (to date)`} fmt={short}
              series={[{ name: "Target to date", colour: "#94a3b8" }, { name: "Achieved", colour: "#8b5cf6" }]}
              rows={target} hrefOf={(l) => drill("director")(l)}
              note="DirectorRevenue against the Projection, month by month to date." />
          : <Donut title="Booking status" slices={[{ label: "Live", v: p.live, colour: "#16a34a" }, { label: "Not Live", v: p.notLive, colour: "#f59e0b" }, { label: "Cancelled", v: p.cancelled, colour: "#ef4444" }]} centre={`${p.bookings + p.cancelled}`} note="Bookings of the period by form status." />}
      </div>

      {plSection}

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        {plDirs.length > 0
          ? <HGroupedChart title="F&F and P&L by Director" fmt={short}
              series={[{ name: "F&F", colour: "#2563eb" }, { name: "P&L", colour: "#f59e0b" }]}
              rows={plDirs.map((x) => ({ label: x.director.split("~")[0], red: isRed(x.director), values: [x.ff, x.pl] }))}
              hrefOf={(l) => drill("director")(l)}
              note={`F&F = ShareAmt − Paid Exp; P&L = ShareAmt × RA% − Paid Exp. Losses grow to the left, in red.${inactive.size ? " Red name = inactive." : ""}`} />
          : <ColumnChart title="ShareAmt per quarter" data={p.months.map((m) => ({ label: m.label, v: m.share }))} colour="#f59e0b" note="Booking level, before overrides." />}
        <LineChart title="Cash in vs cash out by month" labels={cm.map((m) => m.label)}
          series={[{ name: "In", colour: "#16a34a", values: cm.map((m) => m.in) }, { name: "Out", colour: "#ef4444", values: cm.map((m) => m.out) }, { name: "Net", colour: "#2563eb", values: cm.map((m) => m.in - m.out), dashed: true }]}
          note={`All Exp receipts and payments${scoped ? " linked to these bookings" : ""}, by pay date (Billing and NOC entries left out). In ${cr(cm.reduce((s, m) => s + m.in, 0))} · Out ${cr(cm.reduce((s, m) => s + m.out, 0))}.`} />
        <div className="card">
          <h2 className="h2">Top 5 bookings of the period</h2>
          {!top5.length ? <p className="text-sm text-[var(--muted)]">No bookings.</p> : (
            <table className="w-full text-sm">
              <tbody>
                {top5.map((b, i) => (
                  <tr key={b.id} className="border-t border-[var(--line)] first:border-0">
                    <td className="w-5 py-1.5 align-top text-xs font-bold text-[var(--muted)]">{i + 1}</td>
                    <td className="py-1.5">
                      <Link href={`/bookings/${encodeURIComponent(b.id)}`} className="font-medium hover:underline">{b.client || b.id}</Link>
                      <div className="text-[11px] text-[var(--muted)]">{b.id} · {b.project}{b.unit ? ` ${b.unit}` : ""} · <span className={isRed(b.director) ? "font-semibold text-red-600" : ""}>{b.director.split("~")[0]}</span></div>
                    </td>
                    <td className="py-1.5 text-right align-top font-semibold text-green-700">{cr(b.rev)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="mt-1 text-[11px] text-[var(--muted)]">By DirectorRevenue, Live and Not Live.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        {target.length > 0
          ? <Donut title="Booking status" slices={[{ label: "Live", v: p.live, colour: "#16a34a" }, { label: "Not Live", v: p.notLive, colour: "#f59e0b" }, { label: "Cancelled", v: p.cancelled, colour: "#ef4444" }]} centre={`${p.bookings + p.cancelled}`} note="Bookings of the period by form status." />
          : null}
        <div className={target.length > 0 ? "lg:col-span-2" : "lg:col-span-3"}>
          <div className="mb-1 flex flex-wrap items-center gap-1">
            <span className="mr-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">Ranking by</span>
            {(Object.keys(BY_LABEL) as By[]).map((by) => (
              <Link key={by} href={c.href("/dashboard", { rk: by })} scroll={false}
                className={`rounded-full px-3 py-1 text-xs font-medium ${rk === by ? "bg-[var(--brand)] text-white" : "border border-[var(--line)] hover:bg-slate-50"}`}>{BY_LABEL[by]}</Link>
            ))}
          </div>
          <HBarChart wide title={`${BY_LABEL[rk]}s by DirectorRevenue`} hrefOf={drill(rk)} isRed={rk === "director" ? isRed : undefined}
            rows={rank(sbk, rk, from, to, 12).map((r) => ({ name: r.name, v: r.revenue, extra: `${fmtNum(r.count)} bkgs | ${fmtNum(Math.round(r.area))} sq ft | ShareAmt ${cr(r.share)}` }))}
            note="Bar = DirectorRevenue; then bookings | area | ShareAmt (booking level, before overrides). Click a bar to look at it." />
        </div>
      </div>
      <p className="text-xs text-[var(--muted)]">
        More: <Link className="underline" href="/reports/projection">Projection vs Actual</Link>{isMaster && <> · <Link className="underline" href="/reports/pnl">P&amp;L</Link></>} · <Link className="underline" href="/reports/demand">Demand</Link>
      </p>
    </div>
  );
}

