import Link from "next/link";
import { and, desc, eq, inArray } from "drizzle-orm";
import { requireUser } from "@/lib/auth";
import { getDb, schema as s } from "@/lib/db";
import { fmtDate } from "@/lib/format";
import { StatusPill } from "@/components/StatusPill";

export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await requireUser();
  const db = await getDb();
  const waitingFor =
    user.role === "admin" ? ["pending_admin"] : user.role === "master" ? ["pending_master", "pending_admin"] : [];
  const pending = waitingFor.length
    ? await db.select().from(s.submissions).where(inArray(s.submissions.status, waitingFor as never)).orderBy(desc(s.submissions.createdAt)).limit(50)
    : [];
  const mine = await db.select().from(s.submissions).where(eq(s.submissions.submittedBy, user.id)).orderBy(desc(s.submissions.updatedAt)).limit(10);
  const returned = await db.select().from(s.submissions).where(and(eq(s.submissions.submittedBy, user.id), eq(s.submissions.status, "returned")));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="h1">Welcome, {user.name}</h1>
        <Link href="/scd/new" className="btn btn-primary ml-auto">+ New SCD</Link>
      </div>

      {returned.length > 0 && (
        <div className="card border-amber-300 bg-amber-50">
          <b>{returned.length} SCD(s) were sent back to you for changes.</b>{" "}
          {returned.map((r) => <Link key={r.id} className="ml-2 underline" href={`/submissions/${r.id}`}>#{r.id}</Link>)}
        </div>
      )}

      {waitingFor.length > 0 && (
        <section className="card">
          <h2 className="h2">Waiting for your approval ({pending.filter((p) => user.role !== "master" || p.status === "pending_master").length})</h2>
          <List rows={pending} showAll={user.role === "master"} />
        </section>
      )}

      <section className="card">
        <h2 className="h2">My recent SCDs</h2>
        <List rows={mine} showAll />
      </section>
    </div>
  );
}

function List({ rows, showAll }: { rows: (typeof s.submissions.$inferSelect)[]; showAll: boolean }) {
  if (!rows.length) return <p className="text-sm text-[var(--muted)]">Nothing here.</p>;
  return (
    <table className="table">
      <thead><tr><th>#</th><th>Client</th><th>Project / unit</th><th>Booking date</th><th>Status</th><th>BkgID</th></tr></thead>
      <tbody>
        {rows.filter((r) => showAll || r.status !== "pending_admin").map((r) => {
          const d = r.data as Record<string, string>;
          return (
            <tr key={r.id}>
              <td><Link className="text-[var(--brand)] underline" href={`/submissions/${r.id}`}>#{r.id}</Link></td>
              <td>{d.Client}</td>
              <td>{d.Project} {d.UnitNo}</td>
              <td>{fmtDate(d.BkgLoginDate)}</td>
              <td><StatusPill status={r.status} /></td>
              <td>{r.bkgId ? <Link className="underline" href={`/bookings/${r.bkgId}`}>{r.bkgId}</Link> : ""}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

