"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { applyCleanupAction } from "@/app/actions";

export interface ProposalView {
  id: string; title: string; why: string; affected: number; canonical?: string;
  variants?: { value: string; count: number }[]; changes: { from: string; to: string; count: number }[];
}

/** One card per proposal. Nothing is changed until the Master presses "Approve and apply". */
export function CleanupList({ proposals }: { proposals: ProposalView[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [pick, setPick] = useState<Record<string, string>>({});
  const [done, setDone] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  function apply(p: ProposalView) {
    const canon = pick[p.id] ?? p.canonical;
    if (!confirm(`Apply "${p.title}"${p.variants ? ` using "${canon}"` : ""}?\n\n${p.affected.toLocaleString("en-IN")} record(s) will be changed. This cannot be undone from the screen.`)) return;
    setBusy(p.id);
    start(async () => {
      const r = await applyCleanupAction(p.id, canon);
      setDone((d) => ({ ...d, [p.id]: r.message }));
      setBusy(null);
      router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      {proposals.map((p) => (
        <section key={p.id} className="card">
          <div className="flex flex-wrap items-start gap-3">
            <div className="min-w-0 flex-1">
              <h2 className="h2 mb-0">{p.title}</h2>
              <p className="text-xs text-[var(--muted)]">{p.why} <b>{p.affected.toLocaleString("en-IN")}</b> record(s) would change.</p>
            </div>
            {done[p.id] ? <span className="text-sm text-green-700">{done[p.id]}</span> : (
              <button className="btn btn-primary" disabled={pending} onClick={() => apply(p)}>{busy === p.id ? "Applying…" : "Approve and apply"}</button>
            )}
          </div>
          {p.variants && (
            <fieldset className="mt-2">
              <legend className="label">Keep this spelling</legend>
              <div className="flex flex-wrap gap-3 text-sm">
                {p.variants.map((v) => (
                  <label key={v.value} className="flex items-center gap-1.5">
                    <input type="radio" name={`c-${p.id}`} checked={(pick[p.id] ?? p.canonical) === v.value} onChange={() => setPick((x) => ({ ...x, [p.id]: v.value }))} />
                    <span className="font-medium">“{v.value}”</span> <span className="text-xs text-[var(--muted)]">({v.count.toLocaleString("en-IN")})</span>
                  </label>
                ))}
              </div>
            </fieldset>
          )}
          {!p.variants && (
            <div className="tablewrap mt-2 max-h-56">
              <table className="table">
                <thead><tr><th>Now</th><th>Becomes</th><th className="text-right">Records</th></tr></thead>
                <tbody>{p.changes.slice(0, 30).map((c) => <tr key={c.from}><td>“{c.from}”</td><td>“{c.to}”</td><td className="text-right">{c.count.toLocaleString("en-IN")}</td></tr>)}</tbody>
              </table>
            </div>
          )}
        </section>
      ))}
    </div>
  );
}
