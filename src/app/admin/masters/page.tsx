import { asc } from "drizzle-orm";
import { requireUser } from "@/lib/auth";
import { getDb, schema as s } from "@/lib/db";
import { MastersEditor } from "@/components/MastersEditor";
import { PartnersEditor } from "@/components/PartnersEditor";
import { partners } from "@/lib/data";

export const dynamic = "force-dynamic";

export default async function MastersPage() {
  await requireUser(["master"]);
  const db = await getDb();
  const [modes, heads, p, emps] = await Promise.all([
    db.select().from(s.modes).orderBy(asc(s.modes.name)),
    db.select().from(s.expHeads).orderBy(asc(s.expHeads.head)),
    partners(),
    db.selectDistinct({ emp: s.employees.emp }).from(s.employees).orderBy(asc(s.employees.emp)),
  ]);
  return (
    <div className="space-y-4">
      <h1 className="h1">Masters</h1>
      <p className="text-sm text-[var(--muted)]">
        Mode and Head lists used by the Exp form. Note how Bkg reads them: Mode <b>Chq</b> counts as ChqAmt and any other mode as SPD;
        under Head “Brokerage Recd”, modes <b>Billing</b> and <b>NOC</b> go to CommBilled and RecdNOC.
      </p>
      <MastersEditor modes={modes} heads={heads.map((h) => ({ head: h.head, type: h.type ?? "" }))} />
      <PartnersEditor partners={p} employees={emps.map((e) => e.emp)} />
    </div>
  );
}
