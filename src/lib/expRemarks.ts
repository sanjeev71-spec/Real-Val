import "server-only";
import { getDb, schema as s } from "@/lib/db";
import { exceptionRemarks, findExceptions } from "@/lib/calc/exceptions";

type Row = Record<string, unknown> & { id?: number };

/** id of an Exp entry -> what is missing or wrong in it (the same checks as the Data exceptions page). */
export async function expExceptionRemarks(exps: Row[]): Promise<Map<number, string>> {
  const db = await getDb();
  const [emps, heads, bks] = await Promise.all([
    db.selectDistinct({ emp: s.employees.emp }).from(s.employees),
    db.select({ head: s.expHeads.head }).from(s.expHeads),
    db.select({ id: s.bookings.bkgId }).from(s.bookings),
  ]);
  const groups = findExceptions(bks.map((b) => ({ BkgID: b.id })), exps, new Set(emps.map((e) => e.emp)), new Set(heads.map((h) => h.head.toLowerCase())));
  return exceptionRemarks(groups);
}

/** The Emp and Project as TYPED on each entry (the calculated Exp rows show the booking's Project and a derived Emp instead). */
export async function storedExpFields(): Promise<Map<number, { emp: string | null; project: string | null }>> {
  const db = await getDb();
  const r = await db.select({ id: s.expEntries.id, emp: s.expEntries.emp, project: s.expEntries.project }).from(s.expEntries);
  return new Map(r.map((x) => [x.id, { emp: x.emp, project: x.project }]));
}
