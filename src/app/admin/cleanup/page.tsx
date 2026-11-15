import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { getDb, schema as s } from "@/lib/db";
import { cleanupHistory, scanCleanup } from "@/lib/cleanup";
import { CleanupList } from "@/components/CleanupList";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export default async function Cleanup() {
  await requireUser(["master"]);
  const db = await getDb();
  const [proposals, history, users] = await Promise.all([scanCleanup(), cleanupHistory(), db.select({ id: s.users.id, name: s.users.name }).from(s.users)]);
  const who = new Map(users.map((u) => [u.id, u.name]));
  return (
    <div className="space-y-4">
      <div>
        <h1 className="h1">Clean-up</h1>
        <p className="text-sm text-[var(--muted)]">
          The system has just looked through the data and lists what it would tidy. <b>Nothing changes until you approve</b> a proposal; each one is applied on its own and recorded below.
          {" "}Records that are missing information (rather than spelled differently) are in <Link className="link" href="/reports/exceptions">Data exceptions</Link>.
        </p>
      </div>
      {proposals.length === 0
        ? <div className="card text-sm">Nothing to tidy: no spelling variants, stray spaces or mismatched references were found.</div>
        : <CleanupList proposals={proposals.map((p) => ({ id: p.id, title: p.title, why: p.why, affected: p.affected, canonical: p.canonical, variants: p.variants, changes: p.changes }))} />}
      <section className="card overflow-x-auto">
        <h2 className="h2">Already applied</h2>
        {history.length === 0 ? <p className="text-sm text-[var(--muted)]">No clean-up has been applied yet.</p> : (
          <table className="table">
            <thead><tr><th>When</th><th>What</th><th className="text-right">Records</th><th>By</th></tr></thead>
            <tbody>{history.map((h) => <tr key={h.id}><td className="whitespace-nowrap">{h.createdAt.toISOString().slice(0, 16).replace("T", " ")}</td><td>{String((h.detail as { title?: string }).title ?? h.kind)}{(h.detail as { canonical?: string }).canonical ? ` → ${(h.detail as { canonical?: string }).canonical}` : ""}</td><td className="text-right">{h.affected.toLocaleString("en-IN")}</td><td>{who.get(h.appliedBy) ?? "—"}</td></tr>)}</tbody>
          </table>
        )}
      </section>
    </div>
  );
}
