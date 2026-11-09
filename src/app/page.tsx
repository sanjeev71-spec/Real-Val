import Link from "next/link";
import { and, desc, eq, inArray } from "drizzle-orm";
import { requireUser } from "@/lib/auth";
import { getDb, schema as s } from "@/lib/db";
import { fmtDate } from "@/lib/format";
import { StatusPill } from "@/components/StatusPill";
import { describeChange } from "@/lib/changeView";

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
  const changes = await db
    .select()
    .from(s.changeRequests)
    .where(user.role === "master" ? eq(s.changeRequests.status, "pending") : and(eq(s.changeRequests.status, "pending"), eq(s.changeRequests.requestedBy, user.id)))
    .orderBy(desc(s.changeRequests.createdAt))
    .limit(50);
  const isHr = user.role === "hr";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="h1">Welcome, {user.name}</h1>
        <div className="ml-auto flex gap-2">
          {(user.role === "admin" || user.role === "master") && <Link href="/exp/new" className="btn">+ Exp entry</Link>}
          {(isHr || user.role === "master") && <Link href="/emp/new" className="btn">+ Employee</Link>}
          {!isHr && <Link href="/scd/new" className="btn btn-primary">+ New SCD</Link>}
        </div>
      </div>

      {user.role !== "sales" && (
        <section className="card">
          <h2 className="h2">{user.role === "master" ? `Exp / Emp changes waiting for you (${changes.length})` : `My Exp / Emp changes waiting for Master (${changes.length})`}</h2>
          {changes.length ? (
            <table className="table">
              <thead><tr><th>#</th><th>Table</th><th>Action</th><th>What</th><th>When</th></tr></thead>
              <tbody>
                {changes.map((c) => (
                  <tr key={c.id}>
                    <td><Link className="text-[var(--brand)] underline" href={`/changes/${c.id}`}>#{c.id}</Link></td>
                    <td>{c.entity === "exp" ? "Exp" : "Emp"}</td>
                    <td className="capitalize">{c.action}</td>
                    <td className="max-w-md truncate">{describeChange(c.entity, c.data)}</td>
                    <td className="text-xs">{c.createdAt.toLocaleString("en-IN")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <p className="text-sm text-[var(--muted)]">Nothing pending.</p>}
        </section>
      )}

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

      {!isHr && (
        <section className="card">
          <h2 className="h2">My recent SCDs</h2>
          <List rows={mine} showAll />
        </section>
      )}
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

