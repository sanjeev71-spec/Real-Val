"use client";
import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { allUploadCheckAction, allUploadCommitAction, type AllCommitResult, type AllSheetResult } from "@/app/actions";

export function AllUpload() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [inc, setInc] = useState({ Emp: true, Bkg: true, Exp: true });
  const [allowAdd, setAllowAdd] = useState(true);
  const [allowUpdate, setAllowUpdate] = useState(true);
  const [sheets, setSheets] = useState<AllSheetResult[] | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [done, setDone] = useState<AllCommitResult["done"] | null>(null);
  const [pending, start] = useTransition();

  const form = () => {
    const fd = new FormData();
    const f = fileRef.current?.files?.[0];
    if (f) fd.append("file", f);
    fd.append("includeEmp", inc.Emp ? "1" : "0");
    fd.append("includeBkg", inc.Bkg ? "1" : "0");
    fd.append("includeExp", inc.Exp ? "1" : "0");
    fd.append("allowAdd", allowAdd ? "1" : "0");
    fd.append("allowUpdate", allowUpdate ? "1" : "0");
    return fd;
  };
  const reset = () => { setSheets(null); setDone(null); setMsg(null); };
  const active = sheets?.filter((s) => s.included) ?? [];
  const bad = active.some((s) => s.badRows > 0);
  const todo = active.reduce((n, s) => n + s.todo, 0);

  return (
    <div className="space-y-4">
      <div className="card space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <input ref={fileRef} type="file" accept=".xlsx" className="text-sm" onChange={reset} />
        </div>
        <div className="flex flex-wrap items-center gap-4 text-sm">
          <span className="font-semibold">Sheets to apply:</span>
          {(["Emp", "Bkg", "Exp"] as const).map((k) => (
            <label key={k} className="flex items-center gap-1.5"><input type="checkbox" checked={inc[k]} onChange={(e) => { setInc({ ...inc, [k]: e.target.checked }); reset(); }} /> {k}</label>
          ))}
          <label className="flex items-center gap-1.5"><input type="checkbox" checked={allowUpdate} onChange={(e) => { setAllowUpdate(e.target.checked); reset(); }} /> May change existing Bkg / Exp rows</label>
          <label className="flex items-center gap-1.5"><input type="checkbox" checked={allowAdd} onChange={(e) => { setAllowAdd(e.target.checked); reset(); }} /> May add new Bkg / Exp rows</label>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button className="btn" disabled={pending} onClick={() => start(async () => {
            const r = await allUploadCheckAction(form());
            if (!r.ok) { setMsg(r.message ?? "Error"); setSheets(null); return; }
            setSheets(r.sheets ?? []); setMsg(null); setDone(null);
          })}>Check file</button>
          <button className="btn btn-primary" disabled={pending || !sheets || bad || todo === 0} onClick={() => {
            if (!confirm(`Apply ${todo} change(s) now, in the order Emp, Bkg, Exp?`)) return;
            start(async () => {
              const r = await allUploadCommitAction(form());
              if (r.ok) { setDone(r.done ?? []); setSheets(null); setMsg(null); } else { setMsg(r.message ?? "Error"); if (r.done?.length) setDone(r.done); }
            });
          }}>Apply {todo} change(s)</button>
          {pending && <span className="text-sm text-[var(--muted)]">Working… (a large file can take up to a minute)</span>}
        </div>
      </div>

      {msg && <div className="card border-red-300 bg-red-50 text-sm text-red-800">{msg}</div>}
      {done && (
        <div className="card border-green-300 bg-green-50 text-sm space-y-1">
          {done.length === 0 && <div>Nothing needed changing.</div>}
          {done.map((d) => (
            <div key={d.sheet}><b>{d.sheet}</b>: {d.summary} — {d.applied ? "applied" : "sent for approval"} (change <Link className="underline" href={`/changes/${d.id}`}>#{d.id}</Link>)</div>
          ))}
        </div>
      )}

      {sheets && (
        <div className="card space-y-3">
          {sheets.map((s) => (
            <div key={s.sheet} className={`rounded border p-3 text-sm ${s.badRows ? "border-red-300 bg-red-50" : "border-[var(--line)]"}`}>
              <div className="font-semibold">{s.sheet} — {s.summary}{s.included && <span className={s.badRows ? " text-red-700" : " text-green-700"}> · {s.badRows ? `${s.badRows} row(s) with errors` : "all rows OK"}</span>}</div>
              {s.errors.map((e) => <div key={e} className="text-xs text-red-700">{e}</div>)}
              {s.badRows > s.errors.length && <div className="text-xs text-red-700">… and {s.badRows - s.errors.length} more</div>}
              {s.warnings.map((w) => <div key={w} className="text-xs text-amber-800">{w}</div>)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
