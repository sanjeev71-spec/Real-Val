// Local development only: adds dummy inventory units so the SCD flow can be tested.
import "./load-env";
import { sql } from "drizzle-orm";
import { getDb } from "../src/lib/db";

async function main() {
  if (process.env.DATABASE_URL) throw new Error("Refusing to add test units to a real database");
  const db = await getDb();
  await db.execute(sql`insert into inventory (project, unit_no, area) values
    ('Pride Plaza','TEST-1',700),('Pride Plaza','TEST-2',650),('Pride Plaza','TEST-3',500) on conflict do nothing`);
  console.log("test units added");
  process.exit(0);
}
main();
