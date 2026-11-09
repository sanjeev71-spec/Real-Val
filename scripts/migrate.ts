// Applies the SQL migrations in ./drizzle to Neon (DATABASE_URL) or the local PGlite database.
import "./load-env";
import { getDb } from "../src/lib/db";

async function main() {
  if (process.env.VERCEL && !process.env.DATABASE_URL?.startsWith("postgres")) {
    throw new Error("DATABASE_URL is not set on Vercel — connect the Neon database (Storage tab) before deploying.");
  }
  const db = await getDb();
  if (process.env.DATABASE_URL?.startsWith("postgres")) {
    const { migrate } = await import("drizzle-orm/neon-serverless/migrator");
    await migrate(db, { migrationsFolder: "./drizzle" });
  } else {
    const { migrate } = await import("drizzle-orm/pglite/migrator");
    await migrate(db as never, { migrationsFolder: "./drizzle" });
  }
  console.log("migrations applied");
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
