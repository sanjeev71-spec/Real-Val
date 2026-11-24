"use client";
import { useState } from "react";
import { packRecipientsAction, sendPacksAction, type PackRecipient, type PackSendResult } from "@/app/reports/director-pack/actions";

const val = (id: string) => (document.getElementById(id) as HTMLInputElement | null)?.value ?? "";

type Tab = "all" | "active" | "inactive";
const codeOf = (d: string) => (d.split("~")[1] ?? "").toLowerCase();

export default function DirectorPick({ directors: info }: { directors: { name: string; active: boolean }[] }) {
  const directors = info.map((d) => d.name);
  const activeOf = new Map(info.map((d) => [d.name, d.active]));
  const [tab, setTab] = useState<Tab>("all");
  const shown = (d: string) => tab === "all" || (tab === "active") === !!activeOf.get(d);
  // a different booking-from date for some Directors (all-Directors summary)
  const arvind = directors.find((d) => codeOf(d) === "tv0174") ?? "";
  const [ov, setOv] = useState<{ director: string; date: string }[]>(arvind ? [{ director: arvind, date: "2022-08-01" }] : []);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [rec, setRec] = useState<PackRecipient[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<PackSendResult[]>([]);
  const [msg, setMsg] = useState("");
  const set = (all: boolean) => { setSel(all ? new Set(directors.filter(shown)) : new Set()); setRec(null); };
  const toggle = (d: string) => { setRec(null); setSel((p) => { const n = new Set(p); if (n.has(d)) n.delete(d); else n.add(d); return n; }); };

  const preview = async () => {
    setMsg(""); setLog([]);
    if (!sel.size) return setMsg("Tick at least one Director first.");
    setBusy(true);
    try { setRec(await packRecipientsAction(directors.filter((d) => sel.has(d)))); } finally { setBusy(false); }
  };
  const send = async (testOnly: boolean) => {
    if (!rec) return;
    const todo = rec.filter((r) => testOnly || r.email.trim());
    if (!testOnly && !confirm(`Email each Director their own pack (${todo.length} mails, copy to you)?`)) return;
    setBusy(true); setLog([]); setMsg("");
    const all: PackSendResult[] = [];
    try {
      for (let i = 0; i < todo.length; i += 5) {
        const res = await sendPacksAction({ items: todo.slice(i, i + 5), bf: val("bf"), bt: val("bt"), ef: val("ef"), et: val("et"), testOnly });
        all.push(...res); setLog([...all]);
      }
      setMsg(`${all.filter((x) => x.ok).length} of ${all.length} sent${testOnly ? " to you (test)" : ""}.`);
    } catch { setMsg("Sending stopped unexpectedly. Check the list below before trying again."); } finally { setBusy(false); }
  };

  return (
    <div>
      <div className="label flex items-center gap-3">Directors ({sel.size} selected)
        <span className="flex gap-1">
          {([["all", `All (${directors.length})`], ["active", `Active (${info.filter((d) => d.active).length})`], ["inactive", `Inactive (${info.filter((d) => !d.active).length})`]] as [Tab, string][]).map(([t, l]) => (
            <button key={t} type="button" className={`btn ${tab === t ? "btn-primary" : ""}`} onClick={() => setTab(t)}>{l}</button>
          ))}
        </span>
        <button type="button" className="underline" onClick={() => set(true)}>Select all</button>
        <button type="button" className="underline" onClick={() => set(false)}>Clear</button>
      </div>
      <div className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
        {directors.map((d) => (
          <label key={d} className={`flex items-center gap-2 text-sm ${shown(d) ? "" : "hidden"} ${activeOf.get(d) ? "" : "font-medium text-red-600"}`}><input type="checkbox" name="d" value={d} checked={sel.has(d)} onChange={() => toggle(d)} />{d}</label>
        ))}
      </div>

      <div className="mt-4 space-y-2 rounded border border-[var(--line)] p-3">
        <div className="text-sm font-semibold">All-Directors summary (one sheet, a row per Director)</div>
        <p className="text-xs text-[var(--muted)]">Uses the dates above. A Director listed here has bookings counted from their own date instead of Booking from.</p>
        {ov.map((o, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2">
            <select className="input w-64" value={o.director} onChange={(e) => setOv(ov.map((x, j) => (j === i ? { ...x, director: e.target.value } : x)))}>
              {directors.map((d) => <option key={d}>{d}</option>)}
            </select>
            <input type="date" className="input w-44" value={o.date} onChange={(e) => setOv(ov.map((x, j) => (j === i ? { ...x, date: e.target.value } : x)))} />
            <button type="button" className="underline text-sm" onClick={() => setOv(ov.filter((_, j) => j !== i))}>Remove</button>
            <input type="hidden" name="ov" value={`${codeOf(o.director)}|${o.date}`} disabled />
          </div>
        ))}
        {directors.filter(shown).map((d) => <input key={d} type="hidden" name="sd" value={d} disabled />)}
        <p className="text-xs text-[var(--muted)]">Includes the Directors you have ticked; if none is ticked, all Directors of the tab you are on ({tab === "all" ? "All" : tab === "active" ? "Active" : "Inactive"}).</p>
        <div className="flex gap-2">
          <button type="button" className="btn" onClick={() => setOv([...ov, { director: directors[0] ?? "", date: "2022-08-01" }])}>Add another Director</button>
          <button type="submit" className="btn btn-primary" formAction="/api/export/director-summary" onClick={(e) => { const f = e.currentTarget.form; if (f) { f.querySelectorAll('input[name="ov"]').forEach((i) => ((i as HTMLInputElement).disabled = false)); f.querySelectorAll('input[name="sd"]').forEach((i) => ((i as HTMLInputElement).disabled = sel.size > 0)); } }}>Download all-Directors summary</button>
        </div>
      </div>

      <div className="mt-4 space-y-2 rounded border border-[var(--line)] p-3">
        <div className="text-sm font-semibold">Email the packs to the Directors</div>
        <button type="button" className="btn" disabled={busy} onClick={preview}>Preview recipients</button>
        {rec && (
          <div className="space-y-2">
            <table className="table">
              <thead><tr><th>Director</th><th>Email</th></tr></thead>
              <tbody>
                {rec.map((r, i) => (
                  <tr key={r.director}>
                    <td>{r.director}</td>
                    <td><input className="input w-72" type="email" value={r.email} placeholder="missing - type an address" onChange={(e) => setRec(rec.map((x, j) => (j === i ? { ...x, email: e.target.value } : x)))} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-xs text-[var(--muted)]">Directors with no address are skipped. Each Director gets only their own file; you get a copy.</p>
            <div className="flex gap-2">
              <button type="button" className="btn" disabled={busy} onClick={() => send(true)}>Send test to me only</button>
              <button type="button" className="btn btn-primary" disabled={busy} onClick={() => send(false)}>Send to Directors</button>
            </div>
          </div>
        )}
        {busy && <p className="text-sm">Working...</p>}
        {msg && <p className="text-sm font-semibold">{msg}</p>}
        {log.some((l) => !l.ok) && (
          <ul className="text-sm text-red-700">{log.filter((l) => !l.ok).map((l) => <li key={l.director}>{l.director}: {l.message}</li>)}</ul>
        )}
      </div>
    </div>
  );
}
