import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { computedBookings } from "@/lib/data";
import { fmtDate, fmtNum } from "@/lib/format";
import { Pager } from "@/components/Pager";
import { BKG_TEXT_FIELDS, activeBkgFilters, filterBkg } from "@/lib/bkgFilter";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const FIELDS = BKG_TEXT_FIELDS;
const EXTRA_LABEL: Record<string, string> = { sold: "Live + Not Live", status: "Status", month: "Month", from: "From", to: "To", branch: "Branch", due: "Pending due", bill: "Billed, not received" };
const PILL: Record<string, string> = {
  live: "bg-emerald-100 text-emerald-800", "not live": "bg-amber-100 text-amber-800", cancel: "bg-red-100 text-red-700", oa: "bg-slate-200 text-slate-700", "ic bkg": "bg-slate-200 text-slate-700",
};
const num = (v: unknown) => (typeof v === "number" ? v : null);
const text = (v: unknown) => String(v ?? "");
const nameOnly = (v: unknown) => text(v).split("~")[0];

export default async function Bookings({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireUser(["master", "admin", "sales"]);
  const q = await searchParams;
  const size = [50, 100, 250].includes(Number(q.size)) ? Number(q.size) : 100;
  const all = await computedBookings();
  const mine = user.role === "sales" ? all.filter((r) => r.Emp === user.empCode) : all;

  const get = (k: string) => q[k];
  const shown = filterBkg(mine, get);
  const active = activeBkgFilters(get);
  const extra = active.filter(([k]) => k in EXTRA_LABEL);
  const pages = Math.max(1, Math.ceil(shown.length / size));
  const page = Math.min(pages, Math.max(1, Number(q.page) || 1));
  const rows = shown.slice((page - 1) * size, page * size);
  const params = Object.fromEntries(active);
  const exportHref = `/api/export?${new URLSearchParams(params)}`;
  const terms = active;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="h1">Bkg</h1>
        <span className="text-sm text-[var(--muted)]">{shown.length.toLocaleString("en-IN")} of {mine.length.toLocaleString("en-IN")} bookings</span>
        <a className="btn ml-auto" href={exportHref}>Download Excel{terms.length ? " (this search)" : ""}</a>
      </div>

      <form method="get" className="card flex flex-wrap items-end gap-3 py-3">
        {FIELDS.map(([k, label]) => (
          <div key={k} className="min-w-[9rem] flex-1">
            <label className="label" htmlFor={`s-${k}`}>{label}</label>
            <input id={`s-${k}`} name={k} className="input" placeholder="contains…" defaultValue={q[k] ?? ""} />
          </div>
        ))}
        <input type="hidden" name="size" value={size} />
        {extra.map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
        <button className="btn btn-primary">Search</button>
        {terms.length > 0 && <Link className="btn" href="/bookings">Clear</Link>}
      </form>

      {extra.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-[var(--muted)]">Showing:</span>
          {extra.map(([k, v]) => <span key={k} className="rounded-full bg-slate-100 px-2.5 py-1">{EXTRA_LABEL[k]}{v === "1" ? "" : `: ${v}`}</span>)}
        </div>
      )}

      <div className="tablewrap">
        <table className="table">
          <thead>
            <tr>
              <th>BkgID</th><th>Date</th><th>Status</th><th>Director</th><th>Builder</th><th>Project</th><th>Client</th><th>Unit</th><th>Associate</th><th>Branch</th>
              <th className="text-right">Area</th><th className="text-right">TC incl. GST</th><th className="text-right">Received</th><th className="text-right">Pending due</th><th className="text-right">CoRev</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const id = text(r.BkgID);
              const st = text(r.FormStatus).trim();
              return (
                <tr key={id}>
                  <td><Link className="link" href={`/bookings/${encodeURIComponent(id)}`}>{id}</Link></td>
                  <td>{fmtDate(r.BkgLoginDate)}</td>
                  <td><span className={`pill ${PILL[st.toLowerCase()] ?? "bg-slate-100 text-slate-700"}`}>{st || "—"}</span></td>
                  <td><span className="cell-trunc" title={nameOnly(r.Director)}>{nameOnly(r.Director)}</span></td>
                  <td><span className="cell-trunc" title={text(r.Builder)}>{text(r.Builder)}</span></td>
                  <td><span className="cell-trunc" title={text(r.Project)}>{text(r.Project)}</span></td>
                  <td><span className="cell-trunc" title={text(r.Client)}>{text(r.Client)}</span></td>
                  <td>{text(r.UnitNo)}</td>
                  <td><span className="cell-trunc" title={text(r.Emp)}>{nameOnly(r.Emp)}</span></td>
                  <td>{text(r.Branch)}</td>
                  <td className="text-right">{fmtNum(num(r.Area))}</td>
                  <td className="text-right">{fmtNum(num(r.TCWithGST))}</td>
                  <td className="text-right">{fmtNum(num(r.TotalRecdAmt))}</td>
                  <td className="text-right">{fmtNum(num(r.PendDue))}</td>
                  <td className="text-right">{fmtNum(num(r.CoRev))}</td>
                </tr>
              );
            })}
            {!rows.length && <tr><td colSpan={15} className="py-6 text-center text-[var(--muted)]">No bookings match.</td></tr>}
          </tbody>
        </table>
      </div>
      <Pager base="/bookings" params={params} page={page} pages={pages} total={shown.length} size={size} />
    </div>
  );
}
