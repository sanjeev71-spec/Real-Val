"use client";
import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { bulkExpCheckAction, bulkExpCommitAction } from "@/app/actions";
import type { ExpBulkCounts, ExpBulkRow } from "@/lib/bulkExp";
import { fmtDate, fmtNum } from "@/lib/format";

const show = (v: unknown) => (v === null || v === undefined || v === "" ? "—" : String(v));
const KIND = { new: "bg-emerald-50 text-emerald-700", changed: "bg-amber-100 text-amber-800", unchanged: "bg-slate-100 text-slate-600" } as const;

export function BulkExpUpload({ isMaster }: { isMaster: boolean }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [allowUpdate, setAllowUpdate] = useState(true);
  const [allowAdd, setAllowAdd] = useState(true);
  const [rows, setRows] = useState<ExpBulkRow[] | null>(null);
  const [counts, setCounts] = useState<ExpBulkCounts | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [done, setDone] = useState<{ applied: boolean; id?: number; counts?: ExpBulkCounts } | null>(null);
  const [pending, start] = useTransition();

  const form = () => {
    const f = fileRef.current?.files?.[0];
    const fd = new FormData();
    if (f) fd.append("file", f);
    fd.append("allowAdd", allowAdd ? "1" : "0");
    fd.append("allowUpdate", allowUpdate ? "1" : "0");
    return fd;
  };
  const reset = () => { setRows(null); setCounts(null); setDone(null); setMsg(null); };
  const bad = rows?.filter((r) => Object.keys(r.errors).length) ?? [];
  const todo = (counts?.newLines ?? 0) + (counts?.changed ?? 0);

  return (
    <div className="space-y-4">
      <div className="card space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <input ref={fileRef} type="file" accept=".csv,.xlsx" className="text-sm" onChange={reset} />
          <label className="flex items-center gap-1.5 text-sm"><input type="checkbox" checked={allowUpdate} onChange={(e) => { setAllowUpdate(e.target.checked); reset(); }} /> May change existing lines</label>
          <label className="flex items-center gap-1.5 text-sm"><input type="checkbox" checked={allowAdd} onChange={(e) => { setAllowAdd(e.target.checked); reset(); }} /> May add new transactions</label>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button className="btn" disabled={pending} onClick={() => start(async () => {
            const r = await bulkExpCheckAction(form());
            if (!r.ok) return setMsg(r.message ?? "Error");
            setRows(r.rows ?? []); setCounts(r.counts ?? null); setWarnings(r.warnings ?? []); setMsg(null); setDone(null);
          })}>Check file</button>
          <button className="btn btn-primary" disabled={pending || !rows || bad.length > 0 || todo === 0} onClick={() => start(async () => {
            const r = await bulkExpCommitAction(form());
            if (r.ok) { setDone({ applied: !!r.applied, id: r.id, counts: r.counts }); setRows(null); } else setMsg(r.message ?? "Error");
          })}>{isMaster ? `Apply ${todo} change(s) to Exp` : `Send ${todo} change(s) to Master for approval`}</button>
          {pending && <span className="text-sm text-[var(--muted)]">Working…</span>}
        </div>
      </div>

      {msg && <div className="card border-red-300 bg-red-50 text-sm text-red-800">{msg}</div>}
      {done && (
        <div className="card border-green-300 bg-green-50 text-sm">
          {done.applied
            ? <>Done — {done.counts?.newDocs ?? 0} new document(s) ({done.counts?.newLines ?? 0} line(s)) added, {done.counts?.changed ?? 0} existing line(s) changed. <Link className="underline" href="/exp">Open Exp</Link></>
            : <>Sent to Master for approval as change <Link className="underline" href={`/changes/${done.id}`}>#{done.id}</Link>: {done.counts?.newDocs ?? 0} new document(s), {done.counts?.changed ?? 0} changed line(s). Nothing changes in Exp until Master approves.</>}
        </div>
      )}
      {warnings.length > 0 && rows && <div className="card border-amber-300 bg-amber-50 text-sm">{warnings.map((w) => <div key={w}>{w}</div>)}</div>}

      {rows && counts && (
        <div className="card overflow-x-auto">
          <p className="mb-2 text-sm">
            {rows.length} row(s): <b>{counts.newLines}</b> new line(s) in {counts.newDocs} document(s) · <b>{counts.changed}</b> changed · {counts.unchanged} unchanged — {" "}
            <b className={bad.length ? "text-red-700" : "text-green-700"}>{bad.length ? `${bad.length} row(s) with errors` : "all rows OK"}</b>
          </p>
          <table className="table">
            <thead><tr><th>Row</th><th></th><th>Document</th><th>Pay date</th><th>Head</th><th>Mode</th><th>R/P</th><th className="text-right">Gross</th><th>BkgID</th><th>Emp</th><th>Project</th><th>What changes / problems</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.row} className={Object.keys(r.errors).length ? "bg-red-50" : ""}>
                  <td>{r.row}</td>
                  <td><span className={`pill ${KIND[r.kind]}`}>{r.kind}</span></td>
                  <td>{r.doc || "auto number"}</td>
                  <td>{fmtDate(r.line.payDate)}</td>
                  <td>{String(r.line.head ?? "")}</td>
                  <td>{String(r.line.mode ?? "")}</td>
                  <td>{String(r.line.rp ?? "")}</td>
                  <td className="text-right">{fmtNum(r.line.gross)}</td>
                  <td>{String(r.line.bkgId ?? "")}</td>
                  <td>{String(r.line.emp ?? "").split("~")[0]}</td>
                  <td>{String(r.line.project ?? "")}</td>
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
