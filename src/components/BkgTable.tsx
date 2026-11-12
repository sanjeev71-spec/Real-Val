"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { SearchBoxes } from "@/components/DemandReport";
import { fmtDate, fmtNum } from "@/lib/format";

export interface BkgListRow {
  BkgID: string;
  BkgLoginDate: string | null;
  FormStatus: string;
  Director: string;
  Builder: string;
  Project: string;
  Client: string;
  UnitNo: string;
  Emp: string;
  TCWithGST: number | null;
  TotalRecdAmt: number | null;
  CoRev: number | null;
}

/** Same search fields as the Demand report; each matches any part of the text. */
export const BKG_SEARCH: [keyof BkgListRow, string][] = [
  ["Director", "Director"], ["Builder", "Builder"], ["Project", "Project"], ["Client", "Client Name"], ["BkgID", "BkgID"], ["UnitNo", "UnitNo"],
];

export function BkgTable({ rows }: { rows: BkgListRow[] }) {
  const [q, setQ] = useState<Record<string, string>>({});
  const shown = useMemo(() => {
    const terms = BKG_SEARCH.map(([k]) => [k, (q[k] ?? "").trim().toLowerCase()] as const).filter(([, v]) => v);
    return rows.filter((r) => terms.every(([k, v]) => String(r[k] ?? "").toLowerCase().includes(v)));
  }, [rows, q]);
  const exportHref = `/api/export?${new URLSearchParams(Object.entries(q).filter(([, v]) => v.trim()))}`;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm text-[var(--muted)]">{shown.length} of {rows.length}</span>
        <a className="btn ml-auto" href={exportHref}>Download Bkg (.xlsx, all 120 columns{shown.length < rows.length ? ", this search" : ""})</a>
      </div>
      <SearchBoxes fields={BKG_SEARCH as [string, string][]} q={q} setQ={setQ} />
      <div className="card overflow-x-auto">
        <table className="table">
          <thead>
            <tr><th>BkgID</th><th>Date</th><th>Status</th><th>Director</th><th>Builder</th><th>Project</th><th>Client</th><th>UnitNo</th><th>Associate</th>
              <th className="text-right">TC incl. GST</th><th className="text-right">Recd</th><th className="text-right">CoRev</th></tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.BkgID}>
                <td><Link className="text-[var(--brand)] underline" href={`/bookings/${r.BkgID}`}>{r.BkgID}</Link></td>
                <td>{fmtDate(r.BkgLoginDate)}</td>
                <td>{r.FormStatus}</td>
                <td>{r.Director}</td>
                <td>{r.Builder}</td>
                <td>{r.Project}</td>
                <td>{r.Client}</td>
                <td>{r.UnitNo}</td>
                <td>{r.Emp}</td>
                <td className="text-right">{fmtNum(r.TCWithGST)}</td>
                <td className="text-right">{fmtNum(r.TotalRecdAmt)}</td>
                <td className="text-right">{fmtNum(r.CoRev)}</td>
              </tr>
            ))}
            {!shown.length && <tr><td colSpan={12} className="text-[var(--muted)]">No bookings match.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
