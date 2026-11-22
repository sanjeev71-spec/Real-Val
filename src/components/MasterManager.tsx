"use client";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { syncBookingsAction, masterRowDeleteAction, masterRowSaveAction, masterUploadAction, projectsFromBkgAction } from "@/app/actions";
import type { MasterCol } from "@/lib/masterDefs";
import type { MasterCheckRow } from "@/lib/masterData";
import { fmtDate } from "@/lib/format";

type Row = Record<string, string | number | null>;
const SHOW_MAX = 300;
const show = (v: unknown) => (v === null || v === undefined || v === "" ? "—" : String(v));
const cell = (c: MasterCol, v: unknown) => (c.type === "date" && v ? fmtDate(v) : show(v));
const KIND = { new: "bg-emerald-50 text-emerald-700", changed: "bg-amber-100 text-amber-800", unchanged: "bg-slate-100 text-slate-600" } as const;

export function MasterManager({ kind, cols, rows, canSeed = false }: { kind: string; cols: MasterCol[]; rows: Row[]; canSeed?: boolean }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [filter, setFilter] = useState("");
  const [editId, setEditId] = useState<string | null | undefined>(undefined); // undefined = form closed, null = new row
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<string | null>(null);
  const [check, setCheck] = useState<{ rows: MasterCheckRow[]; warnings: string[]; counts: { added: number; changed: number; unchanged: number } } | null>(null);
  const [pending, start] = useTransition();

  const f = filter.trim().toLowerCase();
  const shown = rows.filter((r) => !f || cols.some((c) => String(r[c.key] ?? "").toLowerCase().includes(f)));
  const open = (r: Row | null) => {
    setEditId(r ? String(r._id) : null);
    setDraft(Object.fromEntries(cols.map((c) => [c.key, r?.[c.key] === null || r?.[c.key] === undefined ? "" : String(r[c.key])])));
    setErrors({}); setMsg(null);
  };
  const upload = (commit: boolean) => start(async () => {
    const fd = new FormData();
    const file = fileRef.current?.files?.[0];
    if (file) fd.append("file", file);
    const r = await masterUploadAction(kind, fd, commit);
    if (r.rows) setCheck({ rows: r.rows, warnings: r.warnings ?? [], counts: r.counts! });
    if (!r.ok) return setMsg(r.message ?? "Error");
    if (r.applied) {
      setMsg(`Done - ${r.counts?.added ?? 0} added, ${r.counts?.changed ?? 0} changed.${r.message ? " " + r.message : ""}`); setCheck(null);
      if (fileRef.current) fileRef.current.value = "";
      router.refresh();
    } else setMsg(null);
  });
  const bad = check?.rows.filter((r) => Object.keys(r.errors).length) ?? [];
  const todo = (check?.counts.added ?? 0) + (check?.counts.changed ?? 0);

  return (
    <div className="space-y-4">
      <div className="card space-y-3">
        <h2 className="h2">Upload (adds new rows and corrects existing ones)</h2>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <a className="btn" href={`/api/template/master?kind=${kind}&data=1`}>Download current rows (Excel)</a>
          <a className="btn" href={`/api/template/master?kind=${kind}`}>Blank template (Excel)</a>
          <a className="btn" href={`/api/template/master?kind=${kind}&format=csv`}>CSV header</a>
          {kind === "projects" && (
            <button className="btn" disabled={pending} title="Writes the Project, Builder and Location of this master into every booking of each project (capitals of the project name included)" onClick={() => start(async () => {
              const r = await syncBookingsAction();
              setMsg(r.ok ? (r.bookings ? r.bookings + " booking(s) updated from the Project Master." : "All bookings already agree with the Project Master.") : r.message ?? "Error");
              router.refresh();
            })}>Apply master to all bookings</button>
          )}
          {kind === "projects" && canSeed && (
            <button className="btn" disabled={pending} onClick={() => { if (!window.confirm("Replace the current project list with one built from the bookings in Bkg? This can be done only once; later changes are made here by hand or by upload.")) return; start(async () => {
              const r = await projectsFromBkgAction();
              const c = (r as { conflicts?: { project: string; builders: { value: string }[]; locations: { value: string }[] }[] }).conflicts ?? [];
              setMsg(r.ok ? `From Bkg: ${(r as { added: number }).added} projects created (one-time start; from now on add projects here by hand or by upload).${c.length ? ` Bkg has more than one builder / location for ${c.length} project(s) - the most used was taken, please check: ${c.map((x) => `${x.project} (builders: ${x.builders.map((b) => b.value).join(" / ") || "-"}; locations: ${x.locations.map((l) => l.value).join(" / ") || "-"})`).join("; ")}.` : ""}` : r.message ?? "Error");
              router.refresh();
            }); }}>Create the list from Bkg data (one time only)</button>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input ref={fileRef} type="file" accept=".csv,.xlsx" className="text-sm" onChange={() => { setCheck(null); setMsg(null); }} />
          <button className="btn" disabled={pending} onClick={() => upload(false)}>Check file</button>
          <button className="btn btn-primary" disabled={pending || !check || bad.length > 0 || todo === 0} onClick={() => upload(true)}>Apply {todo} change(s)</button>
          {pending && <span className="text-sm text-[var(--muted)]">Working…</span>}
        </div>
        <p className="text-xs text-[var(--muted)]">A row matching an existing one is corrected (blank keeps the stored value, <code>[clear]</code> empties it); any other row is added. Nothing is deleted by an upload.</p>
      </div>

      {msg && <div className={`card text-sm ${/^(Done|From Bkg)/.test(msg) ? "border-green-300 bg-green-50" : "border-red-300 bg-red-50 text-red-800"}`}>{msg}</div>}
      {check && (
        <div className="card overflow-x-auto">
          {check.warnings.map((w) => <div key={w} className="mb-1 text-sm text-amber-800">{w}</div>)}
          <p className="mb-2 text-sm">
            {check.rows.length} row(s): <b>{check.counts.added}</b> new · <b>{check.counts.changed}</b> changed · {check.counts.unchanged} unchanged —{" "}
            <b className={bad.length ? "text-red-700" : "text-green-700"}>{bad.length ? `${bad.length} row(s) with errors` : "all rows OK"}</b>
          </p>
          <table className="table">
            <thead><tr><th>Row</th><th></th><th>Row</th><th>What changes / problems</th></tr></thead>
            <tbody>
              {check.rows.slice(0, 500).map((r) => (
                <tr key={r.row} className={Object.keys(r.errors).length ? "bg-red-50" : ""}>
                  <td>{r.row}</td>
                  <td><span className={`pill ${KIND[r.kind]}`}>{r.kind}</span></td>
                  <td>{r.label}</td>
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

      {editId !== undefined && (
        <div className="card space-y-3">
          <h2 className="h2">{editId === null ? "Add a row" : "Edit row"}</h2>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            {cols.map((c) => (
              <label key={c.key} className="block">
                <span className="label">{c.label}{c.req ? " *" : ""}</span>
                <input className={`input ${errors[c.key] ? "border-red-500 bg-red-50" : ""}`} type={c.type === "date" ? "date" : "text"} inputMode={c.type === "num" ? "decimal" : undefined}
                  value={draft[c.key] ?? ""} onChange={(e) => setDraft({ ...draft, [c.key]: e.target.value })} />
                {errors[c.key] && <span className="text-xs text-red-700">{errors[c.key]}</span>}
              </label>
            ))}
          </div>
          <div className="flex gap-2">
            <button className="btn btn-primary" disabled={pending} onClick={() => start(async () => {
              const r = await masterRowSaveAction(kind, editId, draft);
              if (r.ok) { setEditId(undefined); setMsg("Done - saved." + (r.message ? " " + r.message : "")); router.refresh(); } else { setErrors(r.errors ?? {}); setMsg(r.message ?? "Please fix the highlighted fields."); }
            })}>Save</button>
            <button className="btn" onClick={() => setEditId(undefined)}>Cancel</button>
          </div>
        </div>
      )}

      <div className="card overflow-x-auto">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <h2 className="h2 !mb-0">{rows.length} row(s)</h2>
          <input className="input max-w-xs" placeholder="Filter" value={filter} onChange={(e) => setFilter(e.target.value)} />
          <button className="btn" onClick={() => open(null)}>+ Add a row</button>
        </div>
        {rows.length === 0 ? <p className="text-sm text-[var(--muted)]">Nothing here yet. Add a row, upload a file{kind === "projects" ? " or create the list from Bkg data (one time)" : ""}.</p> : (
          <table className="table">
            <thead><tr>{cols.map((c) => <th key={c.key} className={c.type === "num" ? "text-right" : ""}>{c.label}</th>)}<th></th></tr></thead>
            <tbody>
              {shown.slice(0, SHOW_MAX).map((r) => (
                <tr key={String(r._id)}>
                  {cols.map((c) => <td key={c.key} className={c.type === "num" ? "text-right" : ""}>{cell(c, r[c.key])}</td>)}
                  <td className="whitespace-nowrap">
                    <button className="underline" onClick={() => open(r)}>Edit</button>{" "}
                    <button className="text-red-700 underline" disabled={pending} onClick={() => {
                      if (!window.confirm("Delete this row? Bookings are not affected.")) return;
                      start(async () => { const x = await masterRowDeleteAction(kind, String(r._id)); setMsg(x.ok ? "Done - deleted." : x.message ?? "Error"); router.refresh(); });
                    }}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {shown.length > SHOW_MAX && <p className="mt-2 text-xs text-[var(--muted)]">Showing the first {SHOW_MAX} of {shown.length}; use the filter to narrow down.</p>}
      </div>
    </div>
  );
}
