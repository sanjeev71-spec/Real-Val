import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { dashContext } from "@/lib/dashPage";
import { dashDemand } from "@/lib/dashData";
import { BY_LABEL, STAGES, inScope, keyOf, quarterBuckets, rankReceiv, receiv, type By, type Stage } from "@/lib/calc/dashScope";
import { fmtNum } from "@/lib/format";
import DashTabs from "@/components/DashTabs";
import DashFilters from "@/components/DashFilters";
import { ColumnChart, Donut, GroupedChart, HBarChart, Tile, cr } from "@/components/DashCharts";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const STAGE_COLOUR: Record<Stage, string> = { "RA Close": "#16a34a", "RA Open": "#f59e0b", "RC open": "#ef4444", Other: "#94a3b8" };
const STAGE_NOTE: Record<Stage, string> = { "RA Close": "RA closed (25% to 100%)", "RA Open": "RC closed, RA open", "RC open": "RC still open", Other: "hold / not live / pref" };

export default async function ReceivablesDashboard({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireUser(["master", "admin"]);
  const c = await dashContext(await searchParams);
  const { bks, exps, scope, from, to, fromIso, toIso } = c;
  const r = receiv(bks, exps, scope, from, to);
  const quarters = quarterBuckets(from, to);

  // pending demands: every live booking in the selection, as of today
  const ids = new Set(bks.filter((b) => inScope(b, scope)).map((b) => b.id.toLowerCase()));
  const byId = new Map(bks.map((b) => [b.id.toLowerCase(), b]));
  const demand = (await dashDemand()).filter((d) => ids.has(d.id.toLowerCase()));
  const dueNow = demand.reduce((s, d) => s + d.dueNow, 0), outstanding = demand.reduce((s, d) => s + d.outstanding, 0), dueCount = demand.filter((d) => d.dueNow > 0).length;
  const demandBy = (by: By) => {
    const m = new Map<string, number>();
    for (const d of demand) { const b = byId.get(d.id.toLowerCase()); if (b && d.dueNow > 0) { const k = keyOf(b, by); m.set(k, (m.get(k) ?? 0) + d.dueNow); } }
    return m;
  };

  const nameMap = new Map(bks.map((b) => [b.director.split("~")[0], b.director]));
  const drill = (by: By) => (name: string) => {
    if (name === "(none)" || name === "(not linked)") return undefined;
    if (by === "director") return c.href("/dashboard/receivables", { director: nameMap.get(name) ?? "" });
    if (by === "builder") return c.href("/dashboard/receivables", { builder: name, project: "" });
    if (by === "project") return c.href("/dashboard/receivables", { project: name });
    return undefined;
  };
  // one chart per dimension: the bar is the due receivable, the other figures follow it separated by |
  const rankRows = (by: By) => {
    const dm = demandBy(by);
    return rankReceiv(bks, exps, scope, by, from, to)
      .map((x) => ({ ...x, demand: dm.get(x.name) ?? 0 }))
      .filter((x) => [x.pendDue, x.billOS, x.collections, x.brokerage, x.demand].some((v) => Math.abs(v) > 0.5))
      .sort((a, b) => b.pendDue - a.pendDue || b.collections - a.collections)
      .slice(0, 12)
      .map((x) => ({ name: x.name, v: x.pendDue, extra: `Collections ${cr(x.collections)} | Brokerage ${cr(x.brokerage)} | Billed OS ${cr(x.billOS)} | Demand due ${cr(x.demand)}` }));
  };
  const inactive = new Set(c.directors.filter((d) => !d.active).map((d) => d.name.split("~")[0]));
  const isRed = (name: string) => inactive.has(name);
  const win = `from=${fromIso}&to=${toIso}`;
  const stageTotal = STAGES.reduce((s, k) => s + r.stage[k].count, 0);
  const sold = r.stage["RA Close"].count + r.stage["RA Open"].count + r.stage["RC open"].count;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start gap-3">
        <div>
          <h1 className="h1">Dashboard</h1>
          <DashTabs active="rec" href={c.href} />
        </div>
        <div className="ml-auto"><DashFilters from={fromIso} to={toIso} director={scope.director} builder={scope.builder} project={scope.project} directors={c.directors} builders={c.builders} projects={c.projects} /></div>
      </div>
      <p className="text-sm text-[var(--muted)]">
        Showing <b className="text-[var(--ink)]">{c.label}</b>. Collections and brokerage are of {fromIso.split("-").reverse().join("-")} to {toIso.split("-").reverse().join("-")}; RA stage is for the bookings of that period; dues and demands are as of today.
        {(scope.director || scope.builder || scope.project) && " Exp rows are counted when linked to a booking of the selection."}
      </p>

      <div className="grid grid-cols-2 gap-2 md:grid-flow-col md:auto-cols-fr">
        <Tile label="Collections from client" value={cr(r.collections)} sub={`Recd From Client ${cr(r.recdClient)} + Form Revised ${cr(r.formRevised)}`} href={`/exp?head=${encodeURIComponent("Recd From Client")}&${win}`} colour="#2563eb" />
        <Tile label="Brokerage Recd" value={cr(r.brokerage)} sub={`NOC ${cr(r.noc)} · billed ${cr(r.billed)}`} href={`/exp?head=${encodeURIComponent("Brokerage Recd")}&${win}`} colour="#16a34a" />
        <Tile label="Due receivables (PendDue)" value={cr(r.pendDue)} sub={`${fmtNum(r.dueBookings)} bookings · as of today`} href={!scope.builder ? `/bookings?sold=1&due=1${scope.director ? `&Director=${encodeURIComponent(scope.director)}` : ""}${scope.project ? `&Project=${encodeURIComponent(scope.project)}` : ""}` : undefined} colour="#ef4444" />
        <Tile label="Billed, not yet received" value={cr(r.billOS)} sub={`${fmtNum(r.billBookings)} bookings · as of today`} colour="#f59e0b" />
        <Tile label="RA Close" value={fmtNum(r.stage["RA Close"].count)} sub={`${cr(r.stage["RA Close"].coRevRA)} revenue realised`} colour="#16a34a" />
        <Tile label="Opened RA (RC closed, RA open)" value={fmtNum(r.stage["RA Open"].count)} sub={`${cr(r.stage["RA Open"].coRev)} revenue to close`} colour="#f59e0b" />
        <Tile label="Pending demands (1st demand due)" value={cr(dueNow)} sub={`${fmtNum(dueCount)} bookings · incl. GST`} href="/reports/demand" colour="#ec4899" />
        <Tile label="Demand outstanding (all stages)" value={cr(outstanding)} sub={`future due after RA ${cr(r.futDue)}`} colour="#8b5cf6" />
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <GroupedChart title="Collections from client per quarter" stacked labels={quarters.map((m) => m.label)} series={[{ name: "Recd From Client", colour: "#2563eb", values: r.months.map((m) => m.recdClient) }, { name: "Form Revised", colour: "#f59e0b", values: r.months.map((m) => m.formRevised) }]} />
        <ColumnChart title="Brokerage Recd per quarter" data={r.months.map((m) => ({ label: m.label, v: m.brokerage }))} colour="#16a34a" note="Excluding NOC and billing entries (shown in the tile)." />
        <Donut title="RA stage (bookings of the period)" slices={STAGES.map((k) => ({ label: `${k} - ${STAGE_NOTE[k]}`, v: r.stage[k].count, colour: STAGE_COLOUR[k] }))} centre={`${stageTotal}`} note={`${sold} live bookings: RA Close ${stageTotal ? Math.round((r.stage["RA Close"].count / Math.max(1, sold)) * 100) : 0}%.`} />
        <HBarChart title="Company revenue by RA stage" rows={STAGES.filter((k) => k !== "Other").map((k) => ({ name: k, v: r.stage[k].coRev, extra: `${r.stage[k].count} bookings` }))} note="CoRevenue of the bookings of the period in each stage." />
      </div>

      <section className="space-y-2">
        <h2 className="h2 !mb-0">Ranking by Director, Builder, Project and Branch</h2>
        <p className="text-xs text-[var(--muted)]">Bar = due receivables (PendDue, as of today); after it: collections | brokerage recd (of the period) | billed not received | 1st demand due. Click a bar to narrow the dashboard to it.</p>
        <div className="grid grid-cols-1 gap-3">
          {(Object.keys(BY_LABEL) as By[]).map((by) => <HBarChart key={by} wide title={`${BY_LABEL[by]}s by due receivables`} rows={rankRows(by)} hrefOf={drill(by)} isRed={by === "director" ? isRed : undefined} note={by === "director" && inactive.size ? "Red = inactive Director." : undefined} />)}
        </div>
      </section>
      <p className="text-xs text-[var(--muted)]">
        More: <Link className="underline" href="/reports/demand">Demand report</Link> · <Link className="underline" href="/bookings?sold=1&due=1">Bookings with revenue due</Link>
      </p>
    </div>
  );
}
