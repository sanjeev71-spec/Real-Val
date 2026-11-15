"use client";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { mergeExpAction, mergePreviewAction } from "@/app/actions";

type Plan = { ok: true; base: string; rows: { id: number; was: string; will: string; payDate: string | null; head: string | null; rp: string | null; gross: number | null; narration: string | null }[] };

/** Ticking entries in the Exp list (checkboxes carry data-merge="<id>") and merging them into one document. */
export function MergeBar() {
  const router = useRouter();
  const [ids, setIds] = useState<number[]>([]);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    const read = () => setIds([...document.querySelectorAll<HTMLInputElement>("input[data-merge]:checked")].map((x) => Number(x.dataset.merge)));
    const on = (e: Event) => { if ((e.target as HTMLElement)?.matches?.("input[data-merge]")) { read(); setPlan(null); } };
    document.addEventListener("change", on);
    read();
    return () => document.removeEventListener("change", on);
  }, []);

  const clear = () => { document.querySelectorAll<HTMLInputElement>("input[data-merge]:checked").forEach((x) => (x.checked = false)); setIds([]); setPlan(null); };
  if (!ids.length && !msg) return null;

  function preview() {
    setMsg(null);
    start(async () => {
      const r = await mergePreviewAction(ids);
      if (!r.ok) setMsg({ ok: false, text: r.message });
      else setPlan(r);
    });
  }
  function confirmMerge() {
    start(async () => {
      const r = await mergeExpAction(ids);
      if (!r.ok) { setMsg({ ok: false, text: r.message ?? "Could not merge" }); return; }
      clear();
      setMsg({ ok: true, text: r.applied ? `Merged into ${r.ref}.` : "Sent to the Master for approval." });
      router.refresh();
    });
  }

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-[var(--line)] bg-white/95 px-4 py-3 shadow-[0_-4px_16px_rgba(0,0,0,0.08)] backdrop-blur">
      <div className="mx-auto flex max-w-[1600px] flex-col gap-2">
        <div className="flex flex-wrap items-center gap-3">
          {ids.length > 0 && <span className="text-sm font-medium">{ids.length} selected</span>}
          {msg && <span className={`text-sm ${msg.ok ? "text-green-700" : "text-red-700"}`}>{msg.text}</span>}
          {ids.length > 0 && <span className="text-xs text-[var(--muted)]">Select 2 to 10 entries (any dates, any heads) to merge them into one document.</span>}
          <span className="ml-auto flex gap-2">
            {ids.length > 0 && !plan && <button className="btn btn-primary" disabled={pending || ids.length < 2 || ids.length > 10} onClick={preview}>Merge selected…</button>}
            {(ids.length > 0 || msg) && <button className="btn" onClick={() => { clear(); setMsg(null); }}>{ids.length > 0 ? "Clear selection" : "Close"}</button>}
          </span>
        </div>
        {plan && (
          <div className="rounded-lg border border-[var(--line)] bg-slate-50 p-3">
            <p className="text-sm">These entries become lines of document <b>{plan.base}</b> (the first entry's number). Amounts and dates do not change.</p>
            <div className="tablewrap mt-2 max-h-48">
              <table className="table">
                <thead><tr><th>Now</th><th>Becomes</th><th>Pay date</th><th>Head</th><th>R/P</th><th className="text-right">Gross</th><th>Narration</th></tr></thead>
                <tbody>{plan.rows.map((r) => <tr key={r.id}><td>{r.was}</td><td className="font-semibold">{r.will}</td><td>{r.payDate}</td><td>{r.head}</td><td>{r.rp}</td><td className="text-right">{r.gross?.toLocaleString("en-IN")}</td><td><span className="cell-trunc max-w-[16rem]">{r.narration}</span></td></tr>)}</tbody>
              </table>
            </div>
            <div className="mt-2 flex gap-2">
              <button className="btn btn-primary" disabled={pending} onClick={confirmMerge}>{pending ? "Merging…" : "Confirm merge"}</button>
              <button className="btn" onClick={() => setPlan(null)}>Back</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
