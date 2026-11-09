"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveHeadAction, saveModeAction } from "@/app/actions";

const TYPES = ["Expense", "Income", "Liability", "Asset", "Billed and Recd", "Contra", "Blank"];

export function MastersEditor({ modes, heads }: { modes: { name: string; active: boolean }[]; heads: { head: string; type: string }[] }) {
  const router = useRouter();
  const [mode, setMode] = useState("");
  const [head, setHead] = useState("");
  const [type, setType] = useState("Expense");
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<{ ok: boolean; message?: string }>, after?: () => void) =>
    start(async () => {
      const r = await fn();
      setMsg(r.ok ? "Saved" : r.message ?? "Error");
      if (r.ok) { after?.(); router.refresh(); }
    });

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="card">
        <h2 className="h2">Mode master</h2>
        <table className="table">
          <thead><tr><th>Mode</th><th>In dropdown</th></tr></thead>
          <tbody>
            {modes.map((m) => (
              <tr key={m.name}>
                <td>{m.name}</td>
                <td><input type="checkbox" checked={m.active} disabled={pending} onChange={(e) => run(() => saveModeAction(m.name, e.target.checked))} /></td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="mt-3 flex gap-2">
          <input className="input" placeholder="New mode, e.g. NEFT" value={mode} onChange={(e) => setMode(e.target.value)} />
          <button className="btn" disabled={pending || !mode.trim()} onClick={() => run(() => saveModeAction(mode, true), () => setMode(""))}>Add</button>
        </div>
      </section>
      <section className="card">
        <h2 className="h2">Head master (ExpType)</h2>
        <div className="max-h-96 overflow-y-auto">
          <table className="table">
            <thead><tr><th>Head</th><th>Type</th></tr></thead>
            <tbody>
              {heads.map((h) => (
                <tr key={h.head}>
                  <td>{h.head}</td>
                  <td>
                    <select className="input" value={h.type} disabled={pending} onChange={(e) => run(() => saveHeadAction(h.head, e.target.value))}>
                      {[...new Set([h.type, ...TYPES])].filter(Boolean).map((t) => <option key={t}>{t}</option>)}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-3 flex gap-2">
          <input className="input" placeholder="New head" value={head} onChange={(e) => setHead(e.target.value)} />
          <select className="input max-w-40" value={type} onChange={(e) => setType(e.target.value)}>{TYPES.map((t) => <option key={t}>{t}</option>)}</select>
          <button className="btn" disabled={pending || !head.trim()} onClick={() => run(() => saveHeadAction(head, type), () => setHead(""))}>Add</button>
        </div>
      </section>
      {msg && <p className="text-sm text-[var(--muted)]">{msg}</p>}
    </div>
  );
}
