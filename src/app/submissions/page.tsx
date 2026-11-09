import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth";
import { getDb, schema as s } from "@/lib/db";
import { fmtDate, STATUS_LABEL } from "@/lib/format";
import { StatusPill } from "@/components/StatusPill";

export const dynamic = "force-dynamic";

export default async function Submissions({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const user = await requireUser();
  const { status } = await searchParams;
  const db = await getDb();
  const rows = await db
    .select({ sub: s.submissions, by: s.users.name })
    .from(s.submissions)
    .leftJoin(s.users, eq(s.users.id, s.submissions.submittedBy))
    .orderBy(desc(s.submissions.updatedAt))
    .limit(500);
  const visible = rows
    .filter((r) => user.role !== "sales" || r.sub.submittedBy === user.id)
    .filter((r) => !status || r.sub.status === status);

  return (
    <div className="space-y-4">
      <h1 className="h1">SCDs & approvals</h1>
      <div className="flex flex-wrap gap-2 text-sm">
        <Link className={`btn ${!status ? "btn-primary" : ""}`} href="/submissions">All</Link>
        {Object.entries(STATUS_LABEL).map(([k, v]) => (
          <Link key={k} className={`btn ${status === k ? "btn-primary" : ""}`} href={`/submissions?status=${k}`}>{v}</Link>
        ))}
      </div>
      <div className="card overflow-x-auto">
        <table className="table">
          <thead><tr><th>#</th><th>Client</th><th>Project / unit</th><th>Associate</th><th>Booking date</th><th>Submitted by</th><th>Status</th><th>BkgID</th><th>Updated</th></tr></thead>
          <tbody>
            {visible.map(({ sub, by }) => {
              const d = sub.data as Record<string, string>;
              return (
                <tr key={sub.id}>
                  <td><Link className="text-[var(--brand)] underline" href={`/submissions/${sub.id}`}>#{sub.id}</Link></td>
                  <td>{d.Client}</td>
                  <td>{d.Project} {d.UnitNo}</td>
                  <td>{d.Emp}</td>
                  <td>{fmtDate(d.BkgLoginDate)}</td>
                  <td>{by}</td>
                  <td><StatusPill status={sub.status} /></td>
                  <td>{sub.bkgId && <Link className="underline" href={`/bookings/${sub.bkgId}`}>{sub.bkgId}</Link>}</td>
                  <td className="text-xs text-[var(--muted)]">{sub.updatedAt.toLocaleString("en-IN")}</td>
                </tr>
              );
            })}
            {!visible.length && <tr><td colSpan={9} className="text-[var(--muted)]">No SCDs.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
