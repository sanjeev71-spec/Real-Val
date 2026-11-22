"use client";
import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { empUploadCheckAction, empUploadCommitAction } from "@/app/actions";
import type { EmpUploadRow } from "@/lib/empUpload";

const show = (v: unknown) => (v === null || v === undefined || v === "" ? "—" : String(v));
const PILL: Record<string, string> = { New: "bg-emerald-50 text-emerald-700", Change: "bg-amber-100 text-amber-800", Correct: "bg-sky-100 text-sky-800", Exit: "bg-rose-100 text-rose-800" };

export function EmpUploadForm({ isMaster }: { isMaster: boolean }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<EmpUploadRow[] | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [done, setDone] = useState<{ applied: boolean; id?: number; count?: number } | null>(null);
  const [pending, start] = useTransition();

  const form = () => {
    const f = fileRef.current?.files?.[0];
    const fd = new FormData();
    if (f) fd.append("file", f);
    return fd;
  };
  const reset = () => { setRows(null); setDone(null); setMsg(null); };
  const bad = rows?.filter((r) => Object.keys(r.errors).length) ?? [];
  const good = (rows?.length ?? 0) - bad.length;

  return (
    <div className="space-y-4">
      <div className="card flex flex-wrap items-center gap-3">
        <input ref={fileRef} type="file" accept=".csv,.xlsx" className="text-sm" onChange={reset} />
        <button className="btn" disabled={pending} onClick={() => start(async () => {
          const r = await empUploadCheckAction(form());
          if (!r.ok) return setMsg(r.message ?? "Error");
          setRows(r.rows ?? []); setWarnings(r.warnings ?? []); setMsg(null); setDone(null);
        })}>Check file</button>
        <button className="btn btn-primary" disabled={pending || !rows || !rows.length || bad.length > 0} onClick={() => start(async () => {
          const r = await empUploadCommitAction(form());
          if (r.ok) { setDone({ applied: !!r.applied, id: r.id, count: r.count }); setRows(null); } else setMsg(r.message ?? "Error");
        })}>{isMaster ? `Apply ${good} row(s) to Emp` : `Send ${good} row(s) to Master for approval`}</button>
        {pending && <span className="text-sm text-[var(--muted)]">Working…</span>}
      </div>

      {msg && <div className="card border-red-300 bg-red-50 text-sm text-red-800">{msg}</div>}
      {done && (
        <div className="card border-green-300 bg-green-50 text-sm">
          {done.applied
            ? <>Done — {done.count} row(s) applied to Emp. <Link className="underline" href="/emp">Open Emp</Link></>
            : <>Sent to Master for approval as change <Link className="underline" href={`/changes/${done.id}`}>#{done.id}</Link>. Nothing changes in Emp until Master approves.</>}
        </div>
      )}
      {warnings.length > 0 && rows && <div className="card border-amber-300 bg-amber-50 text-sm">{warnings.map((w) => <div key={w}>{w}</div>)}</div>}

      {rows && (
        <div className="card overflow-x-auto">
          <p className="mb-2 text-sm">
            {rows.length} row(s) — <b className={bad.length ? "text-red-700" : "text-green-700"}>{bad.length ? `${bad.length} row(s) with errors` : "all rows OK"}</b>
          </p>
          <table className="table">
            <thead><tr><th>Row</th><th>Action</th><th>Employee</th><th>What will happen / problems</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.row} className={Object.keys(r.errors).length ? "bg-red-50" : ""}>
                  <td>{r.row}</td>
                  <td><span className={`pill ${PILL[r.action] ?? "bg-slate-100"}`}>{r.action || "?"}</span></td>
                  <td>{r.emp}</td>
                  <td className="text-xs">
                    {r.changes.map((c) => <div key={c.field}><b>{c.field}</b>: {show(c.from)} → <span className="font-medium text-amber-800">{show(c.to)}</span></div>)}
                    {Object.keys(r.errors).length > 0 && <div className="text-red-700">{Object.entries(r.errors).map(([k, v]) => `${k}: ${v}`).join(" · ")}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
