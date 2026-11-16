import Link from "next/link";
import { fmtDate, fmtNum } from "@/lib/format";

// The Bkg table as shown on the Bkg page AND on Data exceptions: change the columns here and both follow.
type Row = Record<string, unknown>;
const PILL: Record<string, string> = {
  live: "bg-emerald-100 text-emerald-800", "not live": "bg-amber-100 text-amber-800", cancel: "bg-red-100 text-red-700", oa: "bg-slate-200 text-slate-700", "ic bkg": "bg-slate-200 text-slate-700",
};
const num = (v: unknown) => (typeof v === "number" ? v : null);
const text = (v: unknown) => String(v ?? "");
const nameOnly = (v: unknown) => text(v).split("~")[0];
const COLS = 14;

export function BkgTable({ rows, empty = "No bookings match." }: { rows: Row[]; empty?: string }) {
  return (
    <div className="tablewrap">
      <table className="table">
        <thead>
          <tr>
            <th>BkgID</th><th>Date</th><th>Status</th><th>Director</th><th>Builder</th><th>Project</th><th>Client</th><th>Unit</th><th>Associate</th><th>Branch</th>
            <th className="text-right">Area</th><th className="text-right">TC incl. GST</th><th className="text-right">Received</th><th className="text-right">Pending due</th>
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
              </tr>
            );
          })}
          {!rows.length && <tr><td colSpan={COLS} className="py-6 text-center text-[var(--muted)]">{empty}</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
