"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { deleteDraftAction } from "@/app/actions";

/** The signed-in person's saved drafts. */
export function DraftList({ drafts, current }: { drafts: { id: number; title: string; updatedAt: string }[]; current: number | null }) {
  const router = useRouter();
  if (!drafts.length) return null;
  return (
    <section className="card py-3">
      <h2 className="h2">My drafts ({drafts.length})</h2>
      <ul className="flex flex-wrap gap-2">
        {drafts.map((d) => (
          <li key={d.id} className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm ${d.id === current ? "border-[var(--brand)] bg-slate-50" : "border-[var(--line)]"}`}>
            <Link className="link font-medium" href={`/exp/new?draft=${d.id}`}>{d.title}</Link>
            <span className="text-xs text-[var(--muted)]">{d.updatedAt.slice(0, 10)}</span>
            <button type="button" className="text-xs text-red-600 hover:underline" onClick={async () => { if (confirm(`Delete the draft "${d.title}"?`)) { await deleteDraftAction(d.id); router.push("/exp/new"); router.refresh(); } }}>delete</button>
          </li>
        ))}
      </ul>
    </section>
  );
}
