import "server-only";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { getDb, schema as s } from "@/lib/db";

type Row = Record<string, unknown>;
const rowsOf = (r: unknown) => (("rows" in (r as object) ? (r as { rows: Row[] }).rows : r) as Row[]);

export interface HistoryItem {
  id: number; action: string; status: string; comment: string | null; requestedBy: string; decidedBy: string | null;
  createdAt: string; decidedAt: string | null; summary: string;
}

const FIELD_LABEL: Record<string, string> = {
  head: "Head", mode: "Mode", rp: "R/P", gross: "Gross", gst: "GST", tds: "TDS", bkgId: "BkgID", emp: "Employee", project: "Project", narration: "Narration",
  remarks: "Remarks", payDate: "Pay date", valueDate: "Value date", branch: "Branch", purpose: "Purpose", paymentMode: "PaymentMode", instrNo: "Chq/UTR No",
  instrDate: "Chq/UTR Date", chqBank: "Bank", relatedEmpName: "Related Emp Name", expMonth: "ExpMonth",
};
const norm = (v: unknown) => (v === null || v === undefined || v === "" ? "" : String(v));

/** Short plain-language account of what a document change did, from the saved before/after lines. */
export function describeChange(action: string, data: Row, before: Row | null): string {
  const lines = (x: Row | null) => (Array.isArray(x?.lines) ? (x!.lines as Row[]) : []);
  if (action === "create_doc") return `Created with ${lines(data).length} line(s)`;
  if (action === "merge_docs") return `Merged ${lines(data).length} entries into this document (${lines(data).map((l) => l.docNo).join(", ")})`;
  if (action === "rename_docno") return `DocNo changed from ${String(data.fromBase ?? "")} to ${String(data.newBase ?? "")}${lines(data).length > 1 ? ` (${lines(data).length} lines renumbered)` : ""}`;
  if (action === "split_line") return `Line ${lines(data)[0]?.docNo ?? ""} split out into its own document`;
  if (action === "delete_doc") return `Deleted (${lines(before).length} line(s))`;
  if (action === "update_doc") {
    const was = new Map(lines(before).map((l) => [l.id as number, l]));
    const now = lines(data);
    const kept = new Set(now.filter((l) => l.id !== undefined).map((l) => l.id as number));
    const added = now.filter((l) => l.id === undefined).length;
    const removed = [...was.keys()].filter((id) => !kept.has(id)).length;
    const fields = new Set<string>();
    let edited = 0;
    for (const l of now) {
      const o = l.id !== undefined ? was.get(l.id as number) : undefined;
      if (!o) continue;
      const diff = Object.keys(FIELD_LABEL).filter((k) => norm(o[k]) !== norm(l[k]));
      if (diff.length) { edited++; diff.forEach((k) => fields.add(FIELD_LABEL[k])); }
    }
    const parts = [];
    if (edited) parts.push(`${edited} line(s) edited (${[...fields].join(", ")})`);
    if (added) parts.push(`${added} added`);
    if (removed) parts.push(`${removed} removed`);
    return parts.join(" · ") || "Saved with no change";
  }
  // single-line entries
  if (action === "create") return "Created";
  if (action === "delete") return "Deleted";
  const keys = Object.keys(FIELD_LABEL).filter((k) => norm(before?.[k]) !== norm(data[k]));
  return keys.length ? `Changed ${keys.map((k) => FIELD_LABEL[k]).join(", ")}` : "Saved with no change";
}

/** What an Exp upload did to this document: old → new for each changed line, or that it created it. */
function describeUpload(data: Row, lineDocNos: string[], base: string): string {
  const parts: string[] = [];
  for (const u of (Array.isArray(data.updates) ? data.updates : []) as Row[]) {
    if (!lineDocNos.includes(String(u.docNo))) continue;
    const ch = (Array.isArray(u.changes) ? u.changes : []) as { field: string; from: unknown; to: unknown }[];
    parts.push(`${u.docNo}: ${ch.map((c) => `${c.field} ${norm(c.from) || "—"} → ${norm(c.to) || "—"}`).join("; ") || "no change"}`);
  }
  for (const a of (Array.isArray(data.adds) ? data.adds : []) as Row[]) if (a.docBase === base) parts.push(`${(Array.isArray(a.lines) ? a.lines.length : 0)} line(s) added`);
  if (((Array.isArray(data.creates) ? data.creates : []) as Row[]).some((c) => c.docBase === base || c.docNo === base)) parts.push("Created");
  return `Upload (${String(data.fileName ?? "file")}) — ${parts.join(" | ")}`;
}

/** Everything that was requested, approved or rejected for one Exp document, newest first. */
export async function docHistory(base: string, lineDocNos: string[] = []): Promise<HistoryItem[]> {
  const db = await getDb();
  const likeLines = lineDocNos.length ? [...lineDocNos] : [base];
  // a document whose number was changed keeps the history of its earlier numbers
  const bases = [base];
  for (let i = 0; i < bases.length && i < 20; i++) {
    const rn = rowsOf(await db.execute(sql`select data->>'fromBase' as fb, before from change_requests where entity = 'exp' and action = 'rename_docno' and status = 'approved' and data->>'newBase' = ${bases[i]}`));
    for (const x of rn) {
      const fb = String(x.fb ?? "");
      if (fb && !bases.includes(fb)) bases.push(fb);
      for (const l of (((x.before as Row | null)?.lines ?? []) as Row[])) if (l.docNo && !likeLines.includes(String(l.docNo))) likeLines.push(String(l.docNo));
    }
  }
  const arr = (xs: string[]) => sql.raw(`array[${xs.map((x) => `'${x.replace(/'/g, "''")}'`).join(",")}]::text[]`);
  const baseArr = arr(bases);
  const r = rowsOf(await db.execute(sql`
    select cr.id, cr.action, cr.status, cr.comment, cr.created_at, cr.decided_at, cr.data, cr.before,
           ru.name as req_name, du.name as dec_name
    from change_requests cr
    left join users ru on ru.id = cr.requested_by
    left join users du on du.id = cr.decided_by
    where cr.entity = 'exp' and (cr.data->>'docBase' = any(${baseArr}) or cr.before->>'docBase' = any(${baseArr}) or cr.result_ref = any(${baseArr}) or exists (select 1 from jsonb_array_elements_text(coalesce(cr.data->'mergedBases','[]'::jsonb)) mb where mb = any(${baseArr}))
       or cr.data->>'docNo' = any(${sql.raw(`array[${likeLines.map((x) => `'${x.replace(/'/g, "''")}'`).join(",")}]::text[]`)})
       or (cr.action = 'bulk_upload' and (
            exists (select 1 from jsonb_array_elements(coalesce(cr.data->'updates','[]'::jsonb)) u where u->>'docNo' = any(${sql.raw(`array[${likeLines.map((x) => `'${x.replace(/'/g, "''")}'`).join(",")}]::text[]`)}))
         or exists (select 1 from jsonb_array_elements(coalesce(cr.data->'creates','[]'::jsonb)) c where c->>'docBase' = any(${baseArr}) or c->>'docNo' = any(${baseArr}))
         or exists (select 1 from jsonb_array_elements(coalesce(cr.data->'adds','[]'::jsonb)) a where a->>'docBase' = any(${baseArr})))))
    order by cr.id desc
    limit 100`));
  return r.map((x) => ({
    id: Number(x.id), action: String(x.action), status: String(x.status), comment: (x.comment as string) ?? null,
    requestedBy: String(x.req_name ?? "—"), decidedBy: (x.dec_name as string) ?? null,
    createdAt: new Date(x.created_at as string).toISOString(), decidedAt: x.decided_at ? new Date(x.decided_at as string).toISOString() : null,
    summary: String(x.action) === "bulk_upload" ? describeUpload((x.data ?? {}) as Row, likeLines, base) : describeChange(String(x.action), (x.data ?? {}) as Row, (x.before ?? null) as Row | null),
  }));
}

export async function draftsOf(userId: number) {
  const db = await getDb();
  return db.select({ id: s.expDrafts.id, title: s.expDrafts.title, updatedAt: s.expDrafts.updatedAt }).from(s.expDrafts)
    .where(eq(s.expDrafts.userId, userId)).orderBy(desc(s.expDrafts.updatedAt));
}
export async function draftById(id: number, userId: number) {
  const db = await getDb();
  const [d] = await db.select().from(s.expDrafts).where(and(eq(s.expDrafts.id, id), eq(s.expDrafts.userId, userId)));
  return d ?? null;
}

/** Attachments of a document (without the file bytes). */
export async function attachmentsOf(base: string) {
  const db = await getDb();
  return db.select({
    id: s.expAttachments.id, filename: s.expAttachments.filename, mime: s.expAttachments.mime, size: s.expAttachments.size,
    uploadedBy: s.expAttachments.uploadedBy, createdAt: s.expAttachments.createdAt,
  }).from(s.expAttachments).where(eq(s.expAttachments.docBase, base)).orderBy(asc(s.expAttachments.id));
}
