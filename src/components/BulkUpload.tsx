"use client";
import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { bulkCheckAction, bulkCommitAction } from "@/app/actions";
import type { BulkRow } from "@/lib/bulk";
import { fmtDate, fmtNum } from "@/lib/format";

export function BulkUpload() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<BulkRow[] | null>(null);
  const [unknown, setUnknown] = useState<string[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [done, setDone] = useState<string[] | null>(null);
  const [pending, start] = useTransition();

  const form = () => {
    const f = fileRef.current?.files?.[0];
    const fd = new FormData();
    if (f) fd.append("file", f);
    return fd;
  };
  const bad = rows?.filter((r) => Object.keys(r.errors).length) ?? [];

  return (
    <div className="space-y-4">
      <div className="card flex flex-wrap items-center gap-3">
        <input ref={fileRef} type="file" accept=".csv,.xlsx" className="text-sm" onChange={() => { setRows(null); setDone(null); setMsg(null); }} />
        <button className="btn" disabled={pending} onClick={() => start(async () => {
          const r = await bulkCheckAction(form());
          if (!r.ok) return setMsg(r.message ?? "Error");
          setRows(r.rows ?? []); setUnknown(r.unknownColumns ?? []); setMsg(null);
        })}>Check file</button>
        <button className="btn btn-primary" disabled={pending || !rows || !rows.length || bad.length > 0} onClick={() => start(async () => {
          const r = await bulkCommitAction(form());
          if (r.ok) { setDone(r.ids ?? []); setRows(null); } else setMsg(r.message ?? "Error");
        })}>Upload {rows?.length ?? 0} booking(s) to Bkg</button>
        {pending && <span className="text-sm text-[var(--muted)]">Working…</span>}
      </div>

      {msg && <div className="card border-red-300 bg-red-50 text-sm text-red-800">{msg}</div>}
      {done && (
        <div className="card border-green-300 bg-green-50 text-sm">
          Added {done.length} booking(s): {done.map((id) => <Link key={id} href={`/bookings/${id}`} className="mr-2 underline">{id}</Link>)}
        </div>
      )}
      {unknown.length > 0 && <div className="card border-amber-300 bg-amber-50 text-sm">These columns are not in the template and will be ignored: {unknown.join(", ")}</div>}

      {rows && (
        <div className="card overflow-x-auto">
          <p className="mb-2 text-sm">{rows.length} row(s) read — <b className={bad.length ? "text-red-700" : "text-green-700"}>{bad.length ? `${bad.length} with errors` : "all rows OK"}</b></p>
          <table className="table">
            <thead><tr><th>Row</th><th>BkgID</th><th>Date</th><th>Client</th><th>Project / unit</th><th>Associate</th><th>Branch</th><th>Status</th><th className="text-right">BSP</th><th>Problems</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.row} className={Object.keys(r.errors).length ? "bg-red-50" : ""}>
                  <td>{r.row}</td>
                  <td>{String(r.data.BkgID ?? "auto")}</td>
                  <td>{fmtDate(r.data.BkgLoginDate)}</td>
                  <td>{String(r.data.Client ?? "")}</td>
                  <td>{String(r.data.Project ?? "")} {String(r.data.UnitNo ?? "")}</td>
                  <td>{String(r.data.Emp ?? "")}</td>
                  <td>{String(r.data.Branch ?? "")}</td>
                  <td>{String(r.data.FormStatus ?? "")}</td>
                  <td className="text-right">{fmtNum(r.data.BSPPSF)}</td>
                  <td className="text-xs text-red-700">{Object.entries(r.errors).map(([k, v]) => `${k}: ${v}`).join(" · ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
