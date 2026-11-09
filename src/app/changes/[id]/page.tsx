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
  const keys = Object.keys(after).filter((k) => !HIDE.has(k) && k !== "changes" && k !== "reassign" && (canSeePII || !PII.has(k)));
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

      {keys.length > 0 && (
        <section className="card overflow-x-auto">
          <h2 className="h2">{cr.action === "create" ? "New values" : cr.action === "delete" ? "Entry to delete" : "Changes"}</h2>
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
