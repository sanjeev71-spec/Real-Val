import { asc } from "drizzle-orm";
import { requireUser } from "@/lib/auth";
import { getDb, schema as s } from "@/lib/db";
import { loadMasters } from "@/lib/data";
import { employeeNames } from "@/lib/masters";
import { UserEditor } from "@/components/UserEditor";

export const dynamic = "force-dynamic";

export default async function UsersPage() {
  const me = await requireUser(["master"]);
  const db = await getDb();
  const users = await db.select().from(s.users).orderBy(asc(s.users.role), asc(s.users.name));
  const emp = employeeNames(await loadMasters());
  return (
    <div className="space-y-4">
      <h1 className="h1">Users</h1>
      <p className="text-sm text-[var(--muted)]">
        People sign in with a one-time code emailed to the address below — there are no passwords. Disable a user to block access immediately.
        Link Sales users to their Emp name so the form fills the Associate and they only see their own bookings.
      </p>
      <UserEditor users={users.map((u) => ({ id: u.id, email: u.email, name: u.name, role: u.role, empCode: u.empCode ?? "", active: u.active }))} empNames={emp} meId={me.id} />
    </div>
  );
}
