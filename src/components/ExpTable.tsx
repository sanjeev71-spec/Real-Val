import Link from "next/link";
import { fmtDate, fmtNum } from "@/lib/format";

// The Exp table as shown on the Exp page AND on Data exceptions: change the columns here and both follow.
// `selectable` adds the tick boxes used for merging entries (Exp page only).
type Row = Record<string, unknown> & { id?: number };
const text = (v: unknown) => String(v ?? "");
const nameOnly = (v: unknown) => text(v).split("~")[0];

export function ExpTable({ rows, selectable = false, empty = "No entries match." }: { rows: Row[]; selectable?: boolean; empty?: string }) {
  const cols = 12 + (selectable ? 1 : 0);
  return (
    <div className="tablewrap">
      <table className="table">
        <thead>
          <tr>
            {selectable && <th className="w-8"></th>}
            <th>DocNo</th><th>Pay date</th><th>Head</th><th>Mode</th><th className="text-right">NetGross</th><th>Narration</th><th>Project</th><th>BkgID</th><th>Client</th><th>Director</th><th>L0</th><th>L1</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              {selectable && <td><input type="checkbox" data-merge={r.id} aria-label={`Select ${text(r.DocNo || r.id)}`} /></td>}
              <td><Link className="link" href={`/exp/${r.id}`}>{text(r.DocNo || r.id)}</Link></td>
              <td>{fmtDate(r.PayDate)}</td>
              <td>{text(r.Head)}</td>
              <td>{text(r.Mode)}</td>
              <td className={`text-right ${Number(r.SignedGross) < 0 ? "font-medium text-red-600" : ""}`}>{fmtNum(r.SignedGross)}</td>
              <td><span className="cell-trunc max-w-[18rem]" title={text(r.Narration)}>{text(r.Narration)}</span></td>
              <td><span className="cell-trunc" title={text(r.Project)}>{text(r.Project)}</span></td>
              <td>{r.BkgID ? <Link className="link" href={`/bookings/${encodeURIComponent(text(r.BkgID))}`}>{text(r.BkgID)}</Link> : ""}</td>
              <td><span className="cell-trunc" title={text(r.Client)}>{text(r.Client)}</span></td>
              <td><span className="cell-trunc" title={text(r.Director)}>{nameOnly(r.Director)}</span></td>
              <td className="text-xs"><span className="cell-trunc">{nameOnly(r.L0_Emp)} {r.L0_Emp ? fmtNum(r.L0_Amt) : ""}</span></td>
              <td className="text-xs"><span className="cell-trunc">{nameOnly(r.L1_Emp)} {r.L1_Emp ? fmtNum(r.L1_Amt) : ""}</span></td>
            </tr>
          ))}
          {!rows.length && <tr><td colSpan={cols} className="py-6 text-center text-[var(--muted)]">{empty}</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
