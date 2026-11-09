import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth";
import { getDb, schema as s } from "@/lib/db";
import { ACTION_LABEL, ENTITY_LABEL } from "@/lib/changes";
import { CHANGE_STATUS, describeChange } from "@/lib/changeView";

export const dynamic = "force-dynamic";

export default async function Changes({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const user = await requireUser(["admin", "hr", "master"]);
  const { status = "pending" } = await searchParams;
  const db = await getDb();
  const rows = await db
    .select({ c: s.changeRequests, by: s.users.name })
    .from(s.changeRequests)
    .leftJoin(s.users, eq(s.users.id, s.changeRequests.requestedBy))
    .orderBy(desc(s.changeRequests.createdAt))
    .limit(500);
  const shown = rows.filter((r) => (user.role === "master" || r.c.requestedBy === user.id) && (status === "all" || r.c.status === status));
  return (
    <div className="space-y-4">
      <h1 className="h1">Exp & Emp changes</h1>
      <div className="flex flex-wrap gap-2">
        {["pending", "approved", "rejected", "all"].map((st) => (
          <Link key={st} className={`btn capitalize ${status === st ? "btn-primary" : ""}`} href={`/changes?status=${st}`}>{st}</Link>
        ))}
      </div>
      <div className="card overflow-x-auto">
        <table className="table">
          <thead><tr><th>#</th><th>Table</th><th>Action</th><th>What</th><th>Requested by</th><th>When</th><th>Status</th><th>Result</th></tr></thead>
          <tbody>
            {shown.map(({ c, by }) => (
              <tr key={c.id}>
                <td><Link className="text-[var(--brand)] underline" href={`/changes/${c.id}`}>#{c.id}</Link></td>
                <td>{ENTITY_LABEL[c.entity]}</td>
                <td>{ACTION_LABEL[c.action] ?? c.action}</td>
                <td className="max-w-md truncate">{describeChange(c.entity, c.data)}</td>
                <td>{by}</td>
                <td className="text-xs">{c.createdAt.toLocaleString("en-IN")}</td>
                <td><span className={`pill capitalize ${CHANGE_STATUS[c.status] ?? ""}`}>{c.status}</span></td>
                <td>{c.resultRef ?? ""}</td>
              </tr>
            ))}
            {!shown.length && <tr><td colSpan={8} className="text-[var(--muted)]">Nothing here.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
