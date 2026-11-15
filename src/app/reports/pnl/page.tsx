import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { loadPnlData, pnlDirectors, todayIso } from "@/lib/data";
import { computeDirectorSummary, computeTlSummary, computeYearSummary } from "@/lib/calc/pnl";
import { isoToSerial } from "@/lib/calc/excel";
import { fmtNum } from "@/lib/format";
import { COMPANY } from "@/lib/company";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type View = "tl" | "year" | "director";
const VIEWS: [View, string][] = [["tl", "TL-wise"], ["year", "Calendar-year"], ["director", "Director-wise"]];

const money = (v: number) => {
  const r = Math.round(v);
  return r === 0 ? "-" : r < 0 ? `(${fmtNum(-r)})` : fmtNum(r);
};
const neg = (v: number) => (Math.round(v) < 0 ? "text-red-700" : "");
const short = (n: string) => n.split("~")[0];

export default async function PnlPage({ searchParams }: { searchParams: Promise<{ view?: string; director?: string; from?: string; to?: string }> }) {
  await requireUser(["master"]);
  const q = await searchParams;
  const view: View = q.view === "year" || q.view === "director" ? q.view : "tl";
  const today = todayIso();
  const fromIso = /^\d{4}-\d{2}-\d{2}$/.test(q.from ?? "") ? q.from! : `${Number(today.slice(0, 4)) - 3}-01-01`;
  const toIso = /^\d{4}-\d{2}-\d{2}$/.test(q.to ?? "") ? q.to! : today;
  const from = isoToSerial(fromIso)!, to = isoToSerial(toIso)!;
  const [data, directors] = await Promise.all([loadPnlData(), pnlDirectors()]);
  const topName = directors.find((d) => d.endsWith(`~${COMPANY.topCode}`));
  const director = q.director && directors.includes(q.director) ? q.director : topName ?? directors[0] ?? "";
  const href = (v: View) => `/reports/pnl?view=${v}&director=${encodeURIComponent(director)}&from=${fromIso}&to=${toIso}`;
  const exportHref = `/api/export/pnl?view=${view}&director=${encodeURIComponent(director)}&from=${fromIso}&to=${toIso}`;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="h1">P&amp;L</h1>
        <a className="btn ml-auto" href={exportHref}>Download (.xlsx)</a>
      </div>
      <p className="text-sm text-[var(--muted)]">
        Live and Not Live bookings in the period. <b>ShareAmt</b> = revenue share earned; <b>ShareAmt × RA%</b> = the part earned on recovered revenue.
        <b> F&amp;F</b> = ShareAmt − paid expenses; <b>P&amp;L</b> = ShareAmt × RA% − paid expenses. Seat cost is charged day by day to the Director.
      </p>

      <form className="card flex flex-wrap items-end gap-3" method="get">
        <input type="hidden" name="view" value={view} />
        {view !== "director" && (
          <div>
            <label className="label" htmlFor="director">Director</label>
            <select id="director" name="director" className="input" defaultValue={director}>
              {directors.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
        )}
        <div><label className="label" htmlFor="from">From</label><input id="from" name="from" type="date" className="input" defaultValue={fromIso} /></div>
        <div><label className="label" htmlFor="to">To</label><input id="to" name="to" type="date" className="input" defaultValue={toIso} /></div>
        <button className="btn btn-primary">Show</button>
      </form>

      <div className="flex gap-2 border-b border-[var(--line)]">
        {VIEWS.map(([v, label]) => (
          <Link key={v} href={href(v)} className={`px-3 py-2 text-sm ${view === v ? "border-b-2 border-[var(--brand)] font-semibold text-[var(--brand)]" : "text-slate-600"}`}>{label}</Link>
        ))}
      </div>

      {view === "tl" && <TlView {...tlProps(data, director, from, to)} />}
      {view === "year" && <YearView {...yearProps(data, director, from, to)} />}
      {view === "director" && <DirectorView rows={computeDirectorSummary(data, directors, from, to).filter((r) => r.revInc || r.share || r.exp)} />}
    </div>
  );
}

const tlProps = (data: Awaited<ReturnType<typeof loadPnlData>>, director: string, from: number, to: number) => ({ s: computeTlSummary(data, director, from, to), director });
const yearProps = (data: Awaited<ReturnType<typeof loadPnlData>>, director: string, from: number, to: number) => ({ s: computeYearSummary(data, director, from, to), director });

function Row({ label, vals, total, bold, border }: { label: string; vals: number[]; total: number; bold?: boolean; border?: boolean }) {
  return (
    <tr className={`${bold ? "font-bold" : ""} ${border ? "border-t-2 border-slate-700 bg-slate-50" : ""}`}>
      <td className="whitespace-nowrap">{label}</td>
      <td className={`text-right ${neg(total)}`}>{money(total)}</td>
      {vals.map((v, i) => <td key={i} className={`text-right ${neg(v)}`}>{money(v)}</td>)}
    </tr>
  );
}

function TlView({ s, director }: { s: ReturnType<typeof computeTlSummary>; director: string }) {
  const empty = s.cols.length === 0;
  return (
    <div className="card overflow-x-auto">
      <h2 className="h2">TL-wise summary — {director}</h2>
      {empty ? <p className="text-sm text-[var(--muted)]">No data.</p> : (
        <table className="table">
          <thead>
            <tr><th></th><th className="text-right">Total</th>{s.cols.map((c) => <th key={c.code} className="text-right" title={c.name}>{short(c.name)}</th>)}</tr>
          </thead>
          <tbody>
            <Row label="F&F (ShareAmt − Paid Exp)" vals={s.ff} total={s.total.ff} bold border />
            <Row label="P&L (RA − Paid Exp)" vals={s.pl} total={s.total.pl} bold border />
            <Row label="DirectorRevenue + Incentives" vals={s.revInc} total={s.total.revInc} />
            <Row label="ShareAmt" vals={s.share} total={s.total.share} />
            <Row label="ShareAmt × RA%" vals={s.shareRA} total={s.total.shareRA} />
            <Row label="Expense summary – TL wise" vals={s.expTotal} total={s.total.expTotal} bold border />
            {s.heads.map((h) => <Row key={h} label={h} vals={s.exp[h]} total={s.total.exp[h]} />)}
          </tbody>
        </table>
      )}
    </div>
  );
}

function YearView({ s, director }: { s: ReturnType<typeof computeYearSummary>; director: string }) {
  return (
    <div className="card overflow-x-auto">
      <h2 className="h2">Calendar-year summary — {director}</h2>
      <table className="table">
        <thead><tr><th></th><th className="text-right">Total</th>{s.years.map((y) => <th key={y} className="text-right">{y}</th>)}</tr></thead>
        <tbody>
          <Row label="F&F (ShareAmt − Paid Exp)" vals={s.ff} total={s.total.ff} bold border />
          <Row label="P&L (RA − Paid Exp)" vals={s.pl} total={s.total.pl} bold border />
          <Row label="DirectorRevenue + Incentives" vals={s.revInc} total={s.total.revInc} />
          <Row label="ShareAmt" vals={s.share} total={s.total.share} />
          <Row label="ShareAmt × RA%" vals={s.shareRA} total={s.total.shareRA} />
          <Row label="Expense summary" vals={s.expTotal} total={s.total.expTotal} bold border />
          {s.heads.map((h) => <Row key={h} label={h} vals={s.exp[h]} total={s.total.exp[h]} />)}
        </tbody>
      </table>
    </div>
  );
}

function DirectorView({ rows }: { rows: ReturnType<typeof computeDirectorSummary> }) {
  const t = rows.reduce((a, r) => ({ revInc: a.revInc + r.revInc, share: a.share + r.share, shareRA: a.shareRA + r.shareRA, exp: a.exp + r.exp, ff: a.ff + r.ff, pl: a.pl + r.pl }), { revInc: 0, share: 0, shareRA: 0, exp: 0, ff: 0, pl: 0 });
  return (
    <div className="card overflow-x-auto">
      <h2 className="h2">Director-wise summary — all Directors</h2>
      <table className="table">
        <thead>
          <tr><th>Director</th><th className="text-right">F&amp;F (ShareAmt − Paid Exp)</th><th className="text-right">P&amp;L (RA − Paid Exp)</th><th className="text-right">DirectorRevenue + Incentives</th><th className="text-right">ShareAmt</th><th className="text-right">ShareAmt × RA%</th><th className="text-right">Paid Exp</th></tr>
        </thead>
        <tbody>
          <tr className="border-b-2 border-slate-700 bg-slate-50 font-bold">
            <td>Total</td><td className={`text-right ${neg(t.ff)}`}>{money(t.ff)}</td><td className={`text-right ${neg(t.pl)}`}>{money(t.pl)}</td>
            <td className="text-right">{money(t.revInc)}</td><td className="text-right">{money(t.share)}</td><td className="text-right">{money(t.shareRA)}</td><td className="text-right">{money(t.exp)}</td>
          </tr>
          {rows.map((r) => (
            <tr key={r.director}>
              <td>{r.director}</td><td className={`text-right ${neg(r.ff)}`}>{money(r.ff)}</td><td className={`text-right ${neg(r.pl)}`}>{money(r.pl)}</td>
              <td className="text-right">{money(r.revInc)}</td><td className="text-right">{money(r.share)}</td><td className="text-right">{money(r.shareRA)}</td><td className="text-right">{money(r.exp)}</td>
            </tr>
          ))}
          {!rows.length && <tr><td colSpan={7} className="text-[var(--muted)]">No data in this period.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
