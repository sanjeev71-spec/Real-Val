import "server-only";
import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db";

type Row = Record<string, unknown>;
const rowsOf = (r: unknown) => (("rows" in (r as object) ? (r as { rows: Row[] }).rows : r) as Row[]);
const show = (v: unknown) => (v === null || v === undefined || v === "" ? "—" : String(v));

export interface BkgHistoryItem {
  id: number; status: string; comment: string | null; requestedBy: string; decidedBy: string | null;
  createdAt: string; decidedAt: string | null; summary: string;
}

/** Upload changes (requested, approved, rejected) that touched one booking, newest first. */
export async function bkgHistory(bkgId: string): Promise<BkgHistoryItem[]> {
  const db = await getDb();
  const r = rowsOf(await db.execute(sql`
    select cr.id, cr.status, cr.comment, cr.created_at, cr.decided_at, cr.data, ru.name as req_name, du.name as dec_name
    from change_requests cr
    left join users ru on ru.id = cr.requested_by
    left join users du on du.id = cr.decided_by
    where cr.entity = 'bkg' and cr.action = 'bulk_upload'
      and exists (select 1 from jsonb_array_elements(coalesce(cr.data->'updates','[]'::jsonb)) u where upper(u->>'bkgId') = upper(${bkgId}))
    order by cr.id desc
    limit 100`));
  return r.map((x) => {
    const d = (x.data ?? {}) as Row;
    const u = ((Array.isArray(d.updates) ? d.updates : []) as Row[]).find((y) => String(y.bkgId).toUpperCase() === bkgId.toUpperCase());
    const ch = ((u?.changes ?? []) as { field: string; from: unknown; to: unknown }[]);
    return {
      id: Number(x.id), status: String(x.status), comment: (x.comment as string) ?? null,
      requestedBy: String(x.req_name ?? "—"), decidedBy: (x.dec_name as string) ?? null,
      createdAt: new Date(x.created_at as string).toISOString(), decidedAt: x.decided_at ? new Date(x.decided_at as string).toISOString() : null,
      summary: `Upload (${String(d.fileName ?? "file")}) — ${ch.map((c) => `${c.field} ${show(c.from)} → ${show(c.to)}`).join("; ") || "no change"}`,
    };
  });
}
