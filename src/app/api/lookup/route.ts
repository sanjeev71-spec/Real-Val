import { sql } from "drizzle-orm";
import { currentUser } from "@/lib/auth";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

type Row = Record<string, string | null>;
const rowsOf = (r: unknown) => (("rows" in (r as object) ? (r as { rows: Row[] }).rows : r) as Row[]);

/** Type-ahead for the Exp form: ?type=bkg&q=text (BkgID, client or project), ?type=bkg&id=EXACT, or ?type=emp&q=text. Max 15 matches. */
export async function GET(req: Request) {
  const user = await currentUser();
  if (!user || (user.role !== "admin" && user.role !== "master")) return new Response("Not allowed", { status: 403 });
  const u = new URL(req.url);
  const type = u.searchParams.get("type");
  const q = (u.searchParams.get("q") ?? "").trim().slice(0, 60);
  const db = await getDb();

  if (type === "bkg") {
    const id = (u.searchParams.get("id") ?? "").trim();
    const rows = id
      ? rowsOf(await db.execute(sql`select bkg_id, data->>'Client' as client, data->>'Project' as project, data->>'Emp' as emp from bookings where upper(bkg_id) = upper(${id}) limit 1`))
      : q.length < 1
        ? []
        : rowsOf(await db.execute(sql`
            select bkg_id, data->>'Client' as client, data->>'Project' as project, data->>'Emp' as emp
            from bookings
            where bkg_id ilike ${q + "%"} or data->>'Client' ilike ${"%" + q + "%"} or data->>'Project' ilike ${"%" + q + "%"}
            order by (bkg_id ilike ${q + "%"}) desc, bkg_id
            limit 15`));
    return Response.json(rows.map((r) => ({ id: r.bkg_id, client: r.client ?? "", project: r.project ?? "", emp: r.emp ?? "" })));
  }
  if (type === "emp") {
    if (q.length < 1) return Response.json([]);
    const rows = rowsOf(await db.execute(sql`select distinct emp from employees where emp ilike ${"%" + q + "%"} order by emp limit 15`));
    return Response.json(rows.map((r) => r.emp));
  }
  return new Response("Unknown type", { status: 400 });
}
