// Prints row counts per table (no data) — handy to confirm an import.
import "./load-env";
import { sql } from "drizzle-orm";
import { getDb } from "../src/lib/db";

async function main() {
  const db = await getDb();
  for (const t of ["users", "bookings", "employees", "exp_entries", "projects", "inventory", "price_list", "rc_ra", "override_rules"]) {
    const r = await db.execute(sql.raw(`select count(*)::int as n from ${t}`));
    const rows = ("rows" in r ? r.rows : r) as { n: number }[];
    console.log(`${t}: ${rows[0].n}`);
  }
  process.exit(0);
}
main();
