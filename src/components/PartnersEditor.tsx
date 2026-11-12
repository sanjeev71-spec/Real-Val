"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { savePartnersAction } from "@/app/actions";

export function PartnersEditor({ partners, employees }: { partners: string[]; employees: string[] }) {
  const router = useRouter();
  const [list, setList] = useState(partners);
  const [add, setAdd] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const save = (next: string[]) =>
    start(async () => {
      const r = await savePartnersAction(next);
      setMsg(r.ok ? "Saved" : r.message ?? "Error");
      if (r.ok) { setList(next); setAdd(""); router.refresh(); }
    });
  return (
    <section className="card">
      <h2 className="h2">Partners (top row of the org chart)</h2>
      <ul className="space-y-1 text-sm">
        {list.map((p) => (
          <li key={p} className="flex items-center justify-between gap-2">
            <span>{p}</span>
            <button className="btn btn-danger" disabled={pending} onClick={() => save(list.filter((x) => x !== p))}>Remove</button>
          </li>
        ))}
      </ul>
      <div className="mt-3 flex gap-2">
        <input className="input" list="partner-emp" placeholder="Add partner (Name~Code)" value={add} onChange={(e) => setAdd(e.target.value)} />
        <datalist id="partner-emp">{employees.map((e) => <option key={e} value={e} />)}</datalist>
        <button className="btn" disabled={pending || !add.trim()} onClick={() => save([...list, add])}>Add</button>
      </div>
      {msg && <p className="mt-2 text-sm text-[var(--muted)]">{msg}</p>}
    </section>
  );
}
