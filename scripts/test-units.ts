// Adds or removes the TEST-1..TEST-3 Pride Plaza units used for trying the approval flow.
//   npx tsx scripts/test-units.ts add
//   npx tsx scripts/test-units.ts remove   -> also deletes test bookings/submissions on those units
import "./load-env";
import { sql } from "drizzle-orm";
import { getDb } from "../src/lib/db";

async function main() {
  const mode = process.argv[2];
  const db = await getDb();
  if (mode === "add") {
    await db.execute(sql`insert into inventory (project, unit_no, area) values
      ('Pride Plaza','TEST-1',700),('Pride Plaza','TEST-2',650),('Pride Plaza','TEST-3',500)
      on conflict do nothing`);
    console.log("added TEST-1, TEST-2, TEST-3");
  } else if (mode === "remove") {
    const subs = await db.execute(sql`select id from submissions where data->>'UnitNo' like 'TEST-%'`);
    const ids = (("rows" in subs ? subs.rows : subs) as { id: number }[]).map((r) => r.id);
    if (ids.length) {
      await db.execute(sql`delete from approval_events where submission_id in (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})`);
      await db.execute(sql`delete from submissions where id in (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})`);
    }
    await db.execute(sql`delete from bookings where data->>'UnitNo' like 'TEST-%'`);
    await db.execute(sql`delete from inventory where unit_no like 'TEST-%'`);
    console.log(`removed test units, ${ids.length} test SCD(s) and their bookings`);
  } else {
    console.log("usage: test-units.ts add|remove");
  }
  process.exit(0);
}
main();
