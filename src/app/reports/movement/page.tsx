import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { employeesWithCalc, loadCore, loadPnlData, pnlDirectorInfo, todayIso } from "@/lib/data";
import { allEvents, eventGroups, syncBookingEventsQuietly } from "@/lib/bookingEvents";
import { PNL_HEADS, headExpense, pnlHeads } from "@/lib/calc/pnl";
import { codeOf, isoToSerial, num } from "@/lib/calc/excel";
import { fmtNum } from "@/lib/format";
import { SEAT_CHARGED } from "@/lib/company";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Month by month: what each Director actually achieved in the month, net of cancellations and reversals.
// Bookings figures come from the booking event log (each change counts in its effective month); cash, expenses and manpower carry
// their own dates (pay / value date, Emp history rows).
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const money = (v: number) => { const r = Math.round(v); return r === 0 ? "-" : r < 0 ? `(${fmtNum(-r)})` : fmtNum(r); };
const negCls = (v: number) => (Math.round(v) < 0 ? "text-red-700" : "");

export default async function MovementPage({ searchParams }: { searchParams: Promise<{ director?: string; from?: string; to?: string }> }) {
  await requireUser(["master"]);
  const q = await searchParams;
  const today = todayIso();
  const fromIso = /^\d{4}-\d{2}-\d{2}$/.test(q.from ?? "") ? q.from! : `${today.slice(0, 4)}-01-01`;
  const toIso = /^\d{4}-\d{2}-\d{2}$/.test(q.to ?? "") ? q.to! : today;
  await syncBookingEventsQuietly(); // anything saved but not yet recorded
  const [info, events, data, { exps }, emps, toConfirm] = await Promise.all([pnlDirectorInfo(), allEvents(), loadPnlData(), loadCore(), employeesWithCalc(), eventGroups({ unconfirmed: true })]);
  const director = q.director && info.some((d) => d.name === q.director) ? q.director : "";
  const dc = director ? codeOf(director).toLowerCase() : "";
  const mine = (who: string | null | undefined) => !dc || codeOf(who ?? "").toLowerCase() === dc;
  const directors = director ? [director] : info.map((d) => d.name);

  // months of the window
  const months: { label: string; from: string; to: string; f: number; t: number }[] = [];
  for (let d = new Date(`${fromIso.slice(0, 7)}-01T00:00:00Z`); d.toISOString().slice(0, 10) <= toIso; d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1))) {
    const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
    const mf = d.toISOString().slice(0, 10) < fromIso ? fromIso : d.toISOString().slice(0, 10), mt = end > toIso ? toIso : end;
    months.push({ label: `${MON[d.getUTCMonth()]} ${String(d.getUTCFullYear()).slice(2)}`, from: mf, to: mt, f: isoToSerial(mf)!, t: isoToSerial(mt)! });
  }
  const at = (iso: string) => months.findIndex((m) => iso >= m.from && iso <= m.to);
  const zero = () => months.map(() => 0);

  // ---- bookings, from the event log
  const row = { booked: zero(), bookedRev: zero(), cancels: zero(), reversed: zero(), reinstated: zero(), revised: zero(), net: zero(), raClosed: zero(), share: zero(), shareRA: zero() };
  const counted = { booked: new Set<string>(), cancels: new Set<string>(), ra: new Set<string>() };
  for (const e of events) {
    const i = at(e.effectiveDate);
    if (i < 0 || !mine(e.director)) continue;
    const own = e.rev !== 0 || (!e.share && !e.shareRA); // the booking Director's row (override / chain-top rows carry ShareAmt only)
    row.net[i] += e.rev; row.share[i] += e.share; row.shareRA[i] += e.shareRA;
    if (e.kind === "booked") { row.bookedRev[i] += e.rev; if (own && !counted.booked.has(e.grp)) { counted.booked.add(e.grp); row.booked[i]++; } }
    else if (e.kind === "cancel" || e.kind === "deleted") { row.reversed[i] += e.rev; if (own && !counted.cancels.has(e.grp)) { counted.cancels.add(e.grp); row.cancels[i]++; } }
    else if (e.kind === "reinstate") row.reinstated[i] += e.rev;
    else row.revised[i] += e.rev;
    if (e.kind === "ra_close" && !counted.ra.has(e.grp)) { counted.ra.add(e.grp); row.raClosed[i]++; }
  }

  // ---- cash, by pay date (the Director of the Exp row)
  const collections = zero(), brokerage = zero();
  for (const e of exps) {
    const pd = String(e.PayDate ?? "").slice(0, 10), i = pd ? at(pd) : -1;
    if (i < 0 || !mine(String(e.Director ?? ""))) continue;
    const h = String(e.Head ?? "").trim().toLowerCase(), v = num(e.SignedGross as number);
    if (h === "recd from client" || h === "form revised") collections[i] += v;
    if (h === "brokerage recd") brokerage[i] += v;
  }

  // ---- expenses by P&L head, by value date
  const winF = months[0]?.f ?? 0, winT = months[months.length - 1]?.t ?? 0;
  const heads = PNL_HEADS.filter((h) => directors.some((d) => pnlHeads(d, data.exps, winF, winT).includes(h)));
  const headRows = heads.map((h) => ({ head: h, v: months.map((m) => directors.reduce((s, d) => s + headExpense(data, h, d, m.f, m.t), 0)) }));
  const paid = months.map((_, i) => headRows.reduce((s, r) => s + r.v[i], 0));
  const ff = months.map((_, i) => row.share[i] - paid[i]), pl = months.map((_, i) => row.shareRA[i] - paid[i]);

  // ---- manpower (Emp history rows under the Director)
  const head = zero(), joined = zero(), left = zero(), mm = zero();
  const firstFrom = new Map<string, string>();
  for (const r of emps) { const c = codeOf(r.emp).toLowerCase(); const f = firstFrom.get(c); if (!f || r.changeDateFrom < f) firstFrom.set(c, r.changeDateFrom); }
  for (const r of emps) {
    if (!mine(r.calc.director)) continue;
    const to = r.changeDateTo ?? "2099-12-31";
    months.forEach((m, i) => {
      if (r.changeDateFrom <= m.to && to >= m.to && String(r.status ?? "").toLowerCase() !== "inactive") head[i]++;
      const lo = r.changeDateFrom > m.from ? r.changeDateFrom : m.from, hi = to < m.to ? to : m.to;
      if (lo <= hi) mm[i] += ((isoToSerial(hi)! - isoToSerial(lo)! + 1) / (isoToSerial(m.to)! - isoToSerial(m.from)! + 1));
    });
    if (firstFrom.get(codeOf(r.emp).toLowerCase()) === r.changeDateFrom) { const i = at(r.changeDateFrom); if (i >= 0) joined[i]++; }
    if (r.exitDate) { const i = at(r.exitDate); if (i >= 0) left[i]++; }
  }

  const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
  const Line = ({ label, v, total = true, fmt = money, bold, note }: { label: string; v: number[]; total?: boolean; fmt?: (x: number) => string; bold?: boolean; note?: string }) => (
    <tr className={bold ? "border-t-2 border-slate-700 bg-slate-50 font-bold" : ""}>
      <td className="whitespace-nowrap" title={note}>{label}</td>
      <td className={`text-right ${negCls(total ? sum(v) : 0)}`}>{total ? fmt(sum(v)) : ""}</td>
      {v.map((x, i) => <td key={i} className={`text-right ${negCls(x)}`}>{fmt(x)}</td>)}
    </tr>
  );
  const Head = ({ label }: { label: string }) => <tr><td colSpan={months.length + 2} className="!pt-3 text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">{label}</td></tr>;
  const count = (x: number) => (x ? String(Math.round(x * 10) / 10) : "-");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="h1">Monthly movement</h1>
        <Link className="btn ml-auto" href="/reports/pnl">P&amp;L</Link>
      </div>
      <p className="text-sm text-[var(--muted)]">
        What each month actually added, <b>net of cancellations and reversals</b>: a booking counts in its booking month; a cancellation takes its figures off in the month it was cancelled;
        RA closing, price or chain changes count in the month they happened. Cash and expenses follow their own dates, manpower the Emp history.
      </p>
      {toConfirm.length > 0 && (
        <div className="card border-amber-300 bg-amber-50 text-sm">
          <b>{toConfirm.length}</b> old event{toConfirm.length === 1 ? "" : "s"} (cancellations / RA closes recorded before the event log started) have a guessed date.{" "}
          <Link className="font-semibold underline" href="/reports/movement/dates">Confirm the dates →</Link>
        </div>
      )}
      <form className="card flex flex-wrap items-end gap-3" method="get">
        <div>
          <label className="label" htmlFor="director">Director</label>
          <select id="director" name="director" className="input" defaultValue={director}>
            <option value="">All Directors</option>
            {info.map((d) => <option key={d.name} value={d.name} style={d.active ? undefined : { color: "#dc2626" }}>{d.name}{d.active ? "" : " (inactive)"}</option>)}
          </select>
        </div>
        <div><label className="label" htmlFor="from">From</label><input id="from" name="from" type="date" className="input" defaultValue={fromIso} /></div>
        <div><label className="label" htmlFor="to">To</label><input id="to" name="to" type="date" className="input" defaultValue={toIso} /></div>
        <button className="btn btn-primary">Show</button>
      </form>

      <div className="card overflow-x-auto">
        <h2 className="h2">{director ? director : "All Directors"} — {fromIso.split("-").reverse().join("-")} to {toIso.split("-").reverse().join("-")}</h2>
        <table className="table">
          <thead><tr><th></th><th className="text-right">Total</th>{months.map((m) => <th key={m.label} className="text-right">{m.label}</th>)}</tr></thead>
          <tbody>
            <Line label="F&F (ShareAmt − Paid Exp)" v={ff} bold />
            <Line label="P&L (ShareAmt × RA% − Paid Exp)" v={pl} bold />
            <Head label="Bookings" />
            <Line label="New bookings (count)" v={row.booked} fmt={count} />
            <Line label="Revenue booked" v={row.bookedRev} />
            <Line label="Cancellations (count)" v={row.cancels} fmt={count} />
            <Line label="Revenue reversed (cancelled)" v={row.reversed} />
            {sum(row.reinstated.map(Math.abs)) > 0 && <Line label="Revenue reinstated" v={row.reinstated} />}
            <Line label="Revisions (RA, price, chain)" v={row.revised} />
            <Line label="Net DirectorRevenue + Incentives" v={row.net} bold />
            <Line label="RA closed (count)" v={row.raClosed} fmt={count} />
            <Head label="Revenue share (net)" />
            <Line label="ShareAmt" v={row.share} />
            <Line label="ShareAmt × RA%" v={row.shareRA} />
            <Head label="Cash (by pay date)" />
            <Line label="Collections from client" v={collections} note="Recd From Client + Form Revised" />
            <Line label="Brokerage Recd" v={brokerage} />
            <Head label="Paid expenses (by value date)" />
            {headRows.map((r) => <Line key={r.head} label={r.head} v={r.v} />)}
            <Line label="Paid Exp" v={paid} bold />
            <Head label="Manpower" />
            <Line label="Headcount (month end)" v={head} total={false} fmt={count} />
            <Line label="Joined" v={joined} fmt={count} />
            <Line label="Left" v={left} fmt={count} />
            <Line label="Man-months" v={mm} fmt={count} />
          </tbody>
        </table>
        <p className="mt-2 text-xs text-[var(--muted)]">
          Brackets = negative. Revenue share follows the Director-wise P&amp;L (the Director&apos;s share up to their level, plus override). {SEAT_CHARGED ? "Seat cost is in Paid Exp. " : ""}
          Each booking&apos;s events are listed on its page, where Master / Admin can change the month a change counts in.
        </p>
      </div>
    </div>
  );
}
