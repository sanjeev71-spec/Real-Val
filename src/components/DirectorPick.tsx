"use client";
import { useState } from "react";

export default function DirectorPick({ directors }: { directors: string[] }) {
  const [sel, setSel] = useState<Set<string>>(new Set());
  const set = (all: boolean) => setSel(all ? new Set(directors) : new Set());
  const toggle = (d: string) => setSel((p) => { const n = new Set(p); if (n.has(d)) n.delete(d); else n.add(d); return n; });
  return (
    <div>
      <div className="label flex items-center gap-3">Directors ({sel.size} selected)
        <button type="button" className="underline" onClick={() => set(true)}>Select all</button>
        <button type="button" className="underline" onClick={() => set(false)}>Clear</button>
      </div>
      <div className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
        {directors.map((d) => (
          <label key={d} className="flex items-center gap-2 text-sm"><input type="checkbox" name="d" value={d} checked={sel.has(d)} onChange={() => toggle(d)} />{d}</label>
        ))}
      </div>
    </div>
  );
}
