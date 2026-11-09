// Local development only: adds a test Admin and a test Sales user to the local database.
import "./load-env";
import { sql } from "drizzle-orm";
import { getDb } from "../src/lib/db";

async function main() {
  if (process.env.DATABASE_URL) throw new Error("Refusing to add test users to a real database");
  const db = await getDb();
  await db.execute(sql`insert into users (email, name, role, emp_code) values
    ('admin@realv.test', 'Test Admin', 'admin', null),
    ('sales@realv.test', 'Test Sales', 'sales', 'Jagmeet~100052')
    on conflict (email) do nothing`);
  console.log("test users ready: admin@realv.test, sales@realv.test");
  process.exit(0);
}
main();
