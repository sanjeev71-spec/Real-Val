"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { renameExpDocAction } from "@/app/actions";

/** Master only: gives the document a new number. Every line is renumbered (NEW-01, NEW-02 ...); files and history follow it. */
export function RenameDocNo({ base, lines }: { base: string; lines: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(base);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (!open) return <button type="button" className="btn !h-7 text-xs" onClick={() => { setOpen(true); setValue(base); setErr(null); }}>Change DocNo</button>;

  const save = () => {
    const v = value.trim();
    if (!v || v === base) { setErr("Type the new number"); return; }
    if (!confirm(`Change document ${base} to ${v}?${lines > 1 ? ` All ${lines} lines are renumbered ${v}-01, ${v}-02 ...` : ""}`)) return;
    start(async () => {
      const r = await renameExpDocAction(base, v);
      if (!r.ok) { setErr(r.message ?? "Could not change the number"); return; }
      setOpen(false);
      router.refresh();
    });
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="text-xs text-[var(--muted)]" htmlFor="newDocNo">New DocNo</label>
      <input id="newDocNo" className="input !h-8 !w-44" value={value} autoFocus onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") save(); if (e.key === "Escape") setOpen(false); }} />
      <button type="button" className="btn btn-primary !h-7 text-xs" disabled={pending} onClick={save}>{pending ? "Saving…" : "Save"}</button>
      <button type="button" className="btn !h-7 text-xs" disabled={pending} onClick={() => setOpen(false)}>Cancel</button>
      {err && <span className="text-xs text-red-700">{err}</span>}
    </div>
  );
}
