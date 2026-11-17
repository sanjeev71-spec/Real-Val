"use client";
import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { bulkExpCheckAction, bulkExpCommitAction } from "@/app/actions";
import type { ExpBulkRow } from "@/lib/bulkExp";
import { fmtDate, fmtNum } from "@/lib/format";

export function BulkExpUpload() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<ExpBulkRow[] | null>(null);
  const [docs, setDocs] = useState(0);
  const [warnings, setWarnings] = useState<string[]>([]);
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
          const r = await bulkExpCheckAction(form());
          if (!r.ok) return setMsg(r.message ?? "Error");
          setRows(r.rows ?? []); setDocs(r.documents ?? 0); setWarnings(r.warnings ?? []); setMsg(null); setDone(null);
        })}>Check file</button>
        <button className="btn btn-primary" disabled={pending || !rows || !rows.length || bad.length > 0} onClick={() => start(async () => {
          const r = await bulkExpCommitAction(form());
          if (r.ok) { setDone(r.docNos ?? []); setRows(null); } else setMsg(r.message ?? "Error");
        })}>Upload {rows?.length ?? 0} line(s) to Exp</button>
        {pending && <span className="text-sm text-[var(--muted)]">Working…</span>}
      </div>

      {msg && <div className="card border-red-300 bg-red-50 text-sm text-red-800">{msg}</div>}
      {done && (
        <div className="card border-green-300 bg-green-50 text-sm">
          Added {done.length} document(s) to Exp: {done.slice(0, 40).map((d) => <Link key={d} href={`/exp?doc=${encodeURIComponent(d)}`} className="mr-2 underline">{d}</Link>)}{done.length > 40 ? `… and ${done.length - 40} more` : ""}
        </div>
      )}
      {warnings.length > 0 && rows && <div className="card border-amber-300 bg-amber-50 text-sm">{warnings.map((w) => <div key={w}>{w}</div>)}</div>}

      {rows && (
        <div className="card overflow-x-auto">
          <p className="mb-2 text-sm">{rows.length} line(s) in {docs} document(s) — <b className={bad.length ? "text-red-700" : "text-green-700"}>{bad.length ? `${bad.length} line(s) with errors` : "all lines OK"}</b></p>
          <table className="table">
            <thead><tr><th>Row</th><th>DocNo</th><th>Pay date</th><th>Head</th><th>Mode</th><th>R/P</th><th className="text-right">Gross</th><th>Chq / UTR</th><th>BkgID</th><th>Emp</th><th>Problems</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.row} className={Object.keys(r.errors).length ? "bg-red-50" : ""}>
                  <td>{r.row}</td>
                  <td>{r.docNo || "auto"}</td>
                  <td>{fmtDate(r.line.payDate)}</td>
                  <td>{String(r.line.head ?? "")}</td>
                  <td>{String(r.line.mode ?? "")}</td>
                  <td>{String(r.line.rp ?? "")}</td>
                  <td className="text-right">{fmtNum(r.line.gross)}</td>
                  <td>{String(r.line.instrNo ?? "")}</td>
                  <td>{String(r.line.bkgId ?? "")}</td>
                  <td>{String(r.line.emp ?? "").split("~")[0]}</td>
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
