// Database connection: Neon Postgres when DATABASE_URL is set (Vercel), otherwise an
// embedded local Postgres (PGlite) in ./.pglite for development.
import type { NeonDatabase } from "drizzle-orm/neon-serverless";
import * as schema from "./schema";

export type DB = NeonDatabase<typeof schema>;

declare global {
  // eslint-disable-next-line no-var
  var __realvDb: Promise<DB> | undefined;
}

async function connect(): Promise<DB> {
  const url = process.env.DATABASE_URL;
  if (url && url.startsWith("postgres")) {
    const { Pool, neonConfig } = await import("@neondatabase/serverless");
    const { drizzle } = await import("drizzle-orm/neon-serverless");
    const ws = (await import("ws")).default;
    neonConfig.webSocketConstructor = ws;
    return drizzle({ client: new Pool({ connectionString: url }), schema });
  }
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const client = new PGlite(process.env.PGLITE_DIR ?? "./.pglite");
  return drizzle({ client, schema }) as unknown as DB;
}

export function getDb(): Promise<DB> {
  globalThis.__realvDb ??= connect();
  return globalThis.__realvDb;
}

export { schema };
