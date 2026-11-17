import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth";
import { getDb, schema as s } from "@/lib/db";
import { ACTION_LABEL, ENTITY_LABEL, NUDGE_HOURS } from "@/lib/changes";
import { CHANGE_STATUS } from "@/lib/changeView";
import { ChangeDecision } from "@/components/ChangeDecision";

export const dynamic = "force-dynamic";

const PII = new Set(["mobile", "dob", "salary", "minSalary", "fatherName", "motherName", "permanentAddress", "currentAddress", "pan", "aadhaar", "bankName", "bankAccount", "ifsc", "email"]);
const HIDE = new Set(["id", "seq", "periodId", "createdBy", "createdAt", "updatedAt"]);
const show = (v: unknown) => (v === null || v === undefined || v === "" ? "—" : typeof v === "object" ? JSON.stringify(v) : String(v));

export default async function ChangePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser(["admin", "hr", "master"]);
  const id = Number((await params).id);
  const db = await getDb();
  const [cr] = await db.select().from(s.changeRequests).where(eq(s.changeRequests.id, id));
  if (!cr || (user.role !== "master" && cr.requestedBy !== user.id)) notFound();
  const [by] = await db.select().from(s.users).where(eq(s.users.id, cr.requestedBy));
  const [decider] = cr.decidedBy ? await db.select().from(s.users).where(eq(s.users.id, cr.decidedBy)) : [];
  const canSeePII = user.role === "master" || user.role === "hr";

  // Rows to display: for Emp change/correct the "changes" object, else the full data
  const d = cr.data as Record<string, unknown>;
  const before = (cr.before ?? {}) as Record<string, unknown>;
  const after: Record<string, unknown> = cr.entity === "emp" && d.changes ? (d.changes as Record<string, unknown>) : d;
  const keys = Object.keys(after).filter((k) => !HIDE.has(k) && k !== "changes" && k !== "reassign" && k !== "lines" && k !== "creates" && k !== "updates" && k !== "fileName" && (canSeePII || !PII.has(k)));
  const lines = Array.isArray(d.lines) ? (d.lines as Record<string, unknown>[]) : null;
  const beforeLines = Array.isArray(before.lines) ? (before.lines as Record<string, unknown>[]) : [];
  const LINE_COLS = ["docNo", "head", "rp", "mode", "gross", "gst", "tds", "bkgId", "emp", "payDate", "narration", "instrNo", "paymentMode"];
  const creates = Array.isArray(d.creates) ? (d.creates as { docBase: string | null; lines: Record<string, unknown>[] }[]) : [];
  const updates = Array.isArray(d.updates) ? (d.updates as { id: number; docNo: string; changes: { field: string; from: unknown; to: unknown }[] }[]) : [];
  const nudgeWait = cr.lastNudgeAt ? Math.max(0, NUDGE_HOURS * 3600_000 - (Date.now() - cr.lastNudgeAt.getTime())) : 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="h1">{ENTITY_LABEL[cr.entity]} change #{cr.id} — {ACTION_LABEL[cr.action] ?? cr.action}</h1>
        <span className={`pill capitalize ${CHANGE_STATUS[cr.status] ?? ""}`}>{cr.status}</span>
        {cr.resultRef && <span className="text-sm">→ <b>{cr.resultRef}</b></span>}
      </div>
      <p className="text-sm text-[var(--muted)]">
        Requested by {by?.name} on {cr.createdAt.toLocaleString("en-IN")}
        {decider && <> · {cr.status} by {decider.name} on {cr.decidedAt?.toLocaleString("en-IN")}</>}
        {cr.comment && <> · “{cr.comment}”</>}
      </p>
      {Boolean(d.effectiveFrom || d.exitDate) && (
        <div className="card text-sm">{d.effectiveFrom ? <>Effective from <b>{String(d.effectiveFrom)}</b> for {String(d.emp)}</> : <>Exit of <b>{String(d.emp)}</b> on <b>{String(d.exitDate)}</b></>}</div>
      )}

      <ChangeDecision id={cr.id} isMaster={user.role === "master" && cr.status === "pending"} isRequester={cr.requestedBy === user.id && cr.status === "pending"} nudgeWaitMs={nudgeWait} />

      {cr.action === "bulk_upload" && (
        <>
          <div className="card text-sm">File <b>{String(d.fileName ?? "")}</b>: {creates.length} new document(s) · {updates.length} existing line(s) changed. It is applied as one change, or not at all.</div>
          {updates.length > 0 && (
            <section className="card overflow-x-auto">
              <h2 className="h2">Existing lines to change ({updates.length})</h2>
              <table className="table">
                <thead><tr><th>DocNo</th><th>Field</th><th>Before</th><th>After</th></tr></thead>
                <tbody>
                  {updates.flatMap((u) => u.changes.map((c, i) => (
                    <tr key={`${u.id}-${c.field}`} className="bg-amber-50">
                      <td>{i === 0 ? u.docNo : ""}</td><td className="text-[var(--muted)]">{c.field}</td><td>{show(c.from)}</td><td className="font-medium">{show(c.to)}</td>
                    </tr>
                  )))}
                </tbody>
              </table>
            </section>
          )}
          {creates.length > 0 && (
            <section className="card overflow-x-auto">
              <h2 className="h2">New documents ({creates.length})</h2>
              <table className="table">
                <thead><tr><th>Document</th><th>#</th>{LINE_COLS.filter((c) => c !== "docNo").map((c) => <th key={c}>{c}</th>)}</tr></thead>
                <tbody>
                  {creates.flatMap((c, di) => c.lines.map((l, i) => (
                    <tr key={`${di}-${i}`} className="bg-green-50">
                      <td>{i === 0 ? (c.docBase ?? "auto number") : ""}</td><td className="text-xs text-[var(--muted)]">{i + 1}</td>
                      {LINE_COLS.filter((x) => x !== "docNo").map((x) => <td key={x}>{show(l[x])}</td>)}
                    </tr>
                  )))}
                </tbody>
              </table>
            </section>
          )}
        </>
      )}
      {keys.length > 0 && (
        <section className="card overflow-x-auto">
          <h2 className="h2">{cr.action === "create" || cr.action === "create_doc" ? "New values" : cr.action === "delete" ? "Entry to delete" : "Document"}</h2>
          <table className="table">
            <thead><tr><th>Field</th>{cr.before && cr.action !== "delete" && <th>Before</th>}<th>{cr.action === "delete" ? "Value" : "After"}</th></tr></thead>
            <tbody>
              {keys.map((k) => {
                const changed = cr.before && cr.action !== "delete" && show(before[k]) !== show(after[k]);
                return (
                  <tr key={k} className={changed ? "bg-amber-50" : ""}>
                    <td className="text-[var(--muted)]">{k}</td>
                    {cr.before && cr.action !== "delete" && <td>{show(before[k])}</td>}
                    <td className="font-medium">{show(after[k])}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}
      {lines && (
        <section className="card overflow-x-auto">
          <h2 className="h2">{cr.action === "delete_doc" ? "Lines to delete" : `Lines (${lines.length})`}</h2>
          <table className="table">
            <thead><tr><th>#</th>{LINE_COLS.map((c) => <th key={c}>{c}</th>)}<th></th></tr></thead>
            <tbody>
              {lines.map((l, i) => {
                const old = beforeLines.find((b) => b.id !== undefined && b.id === l.id);
                const isNew = cr.action === "update_doc" && l.id === undefined;
                const changed = old ? LINE_COLS.filter((c) => c !== "docNo" && show(old[c]) !== show(l[c])) : [];
                return (
                  <tr key={i} className={isNew ? "bg-green-50" : changed.length ? "bg-amber-50" : ""}>
                    <td className="text-xs text-[var(--muted)]">{i + 1}</td>
                    {LINE_COLS.map((c) => <td key={c} className={changed.includes(c) ? "font-semibold" : ""} title={changed.includes(c) ? `before: ${show(old?.[c])}` : undefined}>{show(c === "docNo" ? l.docNo ?? old?.docNo : l[c])}</td>)}
                    <td className="text-xs">{isNew ? "new" : changed.length ? "changed" : ""}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {cr.action === "update_doc" && beforeLines.filter((b) => !lines.some((l) => l.id === b.id)).length > 0 && (
            <p className="mt-2 text-sm text-red-700">Removed lines: {beforeLines.filter((b) => !lines.some((l) => l.id === b.id)).map((b) => show(b.docNo)).join(", ")}</p>
          )}
        </section>
      )}
      {Array.isArray(d.reassign) && (d.reassign as unknown[]).length > 0 && (
        <section className="card">
          <h2 className="h2">Reportees moved from the day after exit</h2>
          <table className="table">
            <thead><tr><th>Employee</th><th>New reporting head</th></tr></thead>
            <tbody>{(d.reassign as { emp: string; newHead: string }[]).map((r) => <tr key={r.emp}><td>{r.emp}</td><td>{r.newHead}</td></tr>)}</tbody>
          </table>
        </section>
      )}
    </div>
  );
}
