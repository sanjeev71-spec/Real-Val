import { asc } from "drizzle-orm";
import { requireUser } from "@/lib/auth";
import { getDb, schema as s } from "@/lib/db";
import { EmpEditor } from "@/components/EmpEditor";

export const dynamic = "force-dynamic";

export default async function NewEmp() {
  const user = await requireUser(["hr", "master"]);
  const db = await getDb();
  const names = (await db.selectDistinct({ emp: s.employees.emp }).from(s.employees).orderBy(asc(s.employees.emp))).map((e) => e.emp);
  return (
    <div className="space-y-4">
      <div>
        <h1 className="h1">New employee</h1>
        <p className="text-sm text-[var(--muted)]">{user.role === "master" ? "Saved straight into Emp." : "Goes to the Master for approval."}</p>
      </div>
      <EmpEditor mode="create" role={user.role} employees={names} />
    </div>
  );
}
