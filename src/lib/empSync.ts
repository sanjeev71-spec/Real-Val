// Keeps the derived columns of the Emp table (Director, chain path, days worked, man-months, seat cost) up to date.
// This replaces the Excel EmpChainMap sheet: the hierarchy lives in the Emp rows themselves.
//
// One change to one Emp row can alter the Director of other people (their head's period moved), so every
// change recomputes all rows and writes back only the ones whose values changed. Open periods run to today, so
// they are also refreshed once a day (ensureEmpDerived).
import { asc, sql } from "drizzle-orm";
import { getDb, schema as s, type DB } from "./db";
import { Hierarchy } from "./calc/hierarchy";
import { computeEmp } from "./calc/emp";
import { isoToSerial } from "./calc/excel";

type Db = DB | Parameters<Parameters<DB["transaction"]>[0]>[0];

const OPEN_END = isoToSerial("2099-12-31")!;
const todayIso = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
const ser = (d: string | null) => (d === null ? null : isoToSerial(d));

/** Recomputes the derived columns of every Emp row. Returns how many rows changed. Run inside the same transaction as the Emp change. */
export async function resyncEmployees(db: Db): Promise<number> {
  const rows = await db.select().from(s.employees).orderBy(asc(s.employees.seq));
  const today = isoToSerial(todayIso())!;
  const H = new Hierarchy(
    rows.map((r) => ({
      emp: r.emp, reportingHead: r.reportingHead, revShare: r.revShare, expShare: r.expShare, branch: r.branch,
      changeDateFrom: ser(r.changeDateFrom)!, changeDateTo: r.changeDateTo === null ? OPEN_END : ser(r.changeDateTo)!,
    })),
  );
  const pending: { id: number; director: string | null; chainPath: string | null; daysWorked: number; manMonths: number; seatCost: number; derivedOn: string }[] = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const from = ser(r.changeDateFrom)!;
    const c = computeEmp(H, H.rows[i], {
      applicable: r.applicable, type: r.type, doj: ser(r.doj),
      to: r.changeDateTo === null ? Math.max(today, from) : undefined,
    });
    const code = r.emp.split("~")[1] ?? "";
    let chain = "";
    try { chain = code ? H.chainCodes(code, from) : ""; } catch { chain = ""; }
    const next = {
      director: c.director || null,
      chainPath: chain || null,
      daysWorked: c.daysWorked,
      manMonths: c.manMonths,
      seatCost: c.seatCost,
      derivedOn: todayIso(),
    };
    // the "computed on" date only matters for open periods (they are refreshed daily) and rows never computed
    const stamp = r.changeDateTo === null || r.derivedOn === null ? r.derivedOn === next.derivedOn : true;
    const same =
      r.director === next.director && r.chainPath === next.chainPath && r.daysWorked === next.daysWorked &&
      r.manMonths === next.manMonths && r.seatCost === next.seatCost && stamp;
    if (same) continue;
    pending.push({ id: r.id, ...next });
  }
  // written back in a few big statements (one statement per row timed out on a full Emp table)
  for (let i = 0; i < pending.length; i += 400) {
    const vals = sql.join(
      pending.slice(i, i + 400).map((x) => sql`(${x.id}::int, ${x.director}::text, ${x.chainPath}::text, ${x.daysWorked}::int, ${x.manMonths}::float8, ${x.seatCost}::float8, ${x.derivedOn}::date)`),
      sql`, `,
    );
    await db.execute(sql`update employees e set director = v.director, chain_path = v.chain_path, days_worked = v.dw, man_months = v.mm, seat_cost = v.sc, derived_on = v.d
      from (values ${vals}) as v(id, director, chain_path, dw, mm, sc, d) where e.id = v.id`);
  }
  return pending.length;
}

/** Refreshes the derived columns when any row has never been computed or an open period was last computed before today. */
export async function ensureEmpDerived(): Promise<void> {
  const db = await getDb();
  const r = await db.execute(
    sql`select count(*)::int as n from employees where derived_on is null or (change_date_to is null and derived_on < ${todayIso()}::date)`,
  );
  const n = (("rows" in r ? r.rows : r) as { n: number }[])[0]?.n ?? 0;
  if (n > 0) await db.transaction((tx) => resyncEmployees(tx));
}
