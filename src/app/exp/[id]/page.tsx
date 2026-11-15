import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth";
import { getDb, schema as s } from "@/lib/db";
import { bookingsByIds, expContext, expFormData, expInputOf } from "@/lib/data";
import { computeExp } from "@/lib/calc/exp";
import { docLines } from "@/lib/changes";
import { fmtNum } from "@/lib/format";
import { ExpDocForm, type DocLine } from "@/components/ExpDocForm";
import { AttachmentsPanel } from "@/components/AttachmentsPanel";
import { attachmentsOf, docHistory } from "@/lib/expExtras";

export const dynamic = "force-dynamic";

/** Opens the whole document that a line belongs to. */
export default async function ExpDocument({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser(["admin", "master"]);
  const id = Number((await params).id);
  const db = await getDb();
  const [line] = await db.select().from(s.expEntries).where(eq(s.expEntries.id, id));
  if (!line) notFound();
  const base = line.docBase ?? line.docNo ?? String(line.id);
  const rows = line.docBase || line.docNo ? await docLines(db, base) : [line];
  const [f, ctx, known] = await Promise.all([expFormData(), expContext(), bookingsByIds(rows.map((r) => r.bkgId ?? ""))]);
  const [atts, history, userNames] = await Promise.all([attachmentsOf(base), docHistory(base, rows.map((r) => r.docNo ?? "").filter(Boolean)), db.select({ id: s.users.id, name: s.users.name }).from(s.users)]);
  const nameOf = new Map(userNames.map((u) => [u.id, u.name]));
  const calc = rows.map((e) => computeExp(expInputOf(e), ctx));
  const first = rows[0];
  const lines: DocLine[] = rows.map((e, i) => ({
    id: e.id, payDate: e.payDate, valueDate: e.valueDate, head: e.head, mode: e.mode, rp: e.rp, gross: e.gross, gst: e.gst, tds: e.tds,
    branch: e.branch, bkgId: e.bkgId, emp: e.emp ?? (calc[i].Emp as string), project: e.project, narration: e.narration, remarks: e.remarks,
    purpose: e.purpose, paymentMode: e.paymentMode, instrNo: e.instrNo, instrDate: e.instrDate, chqBank: e.chqBank,
  }));
  const header = { docNo: base, payDate: first.payDate, valueDate: first.valueDate, mode: first.mode, branch: first.branch, narration: first.narration };
  return (
    <div className="space-y-4">
      <h1 className="h1">Exp document {base}</h1>
      <p className="text-sm text-[var(--muted)]">{user.role === "master" ? "Changes are saved immediately." : "Edits and deletions go to the Master for approval."}</p>
      <ExpDocForm key={base} role={user.role} {...f} docBase={base} knownBookings={known} initial={{ header, lines }} />
      <AttachmentsPanel base={base} userId={user.id} isMaster={user.role === "master"}
        items={atts.map((a) => ({ id: a.id, filename: a.filename, mime: a.mime, size: a.size, uploadedBy: a.uploadedBy, uploadedByName: nameOf.get(a.uploadedBy) ?? "—", createdAt: a.createdAt.toISOString() }))} />
      <section className="card overflow-x-auto">
        <h2 className="h2">History of this document</h2>
        {history.length === 0 ? <p className="text-sm text-[var(--muted)]">No change has been made through the system since it was imported.</p> : (
          <table className="table">
            <thead><tr><th>When</th><th>What</th><th>By</th><th>Decision</th><th>Comment</th><th></th></tr></thead>
            <tbody>
              {history.map((h) => (
                <tr key={h.id}>
                  <td className="whitespace-nowrap">{h.createdAt.slice(0, 16).replace("T", " ")}</td>
                  <td>{h.summary}</td>
                  <td className="whitespace-nowrap">{h.requestedBy}</td>
                  <td className="whitespace-nowrap">{h.status}{h.decidedBy ? ` · ${h.decidedBy}` : ""}{h.decidedAt ? ` · ${h.decidedAt.slice(0, 10)}` : ""}</td>
                  <td>{h.comment ?? ""}</td>
                  <td><a className="link" href={`/changes/${h.id}`}>#{h.id}</a></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      <section className="card overflow-x-auto">
        <h2 className="h2">Calculated (as saved)</h2>
        <table className="table">
          <thead><tr><th>DocNo</th><th>Head</th><th>Type</th><th className="text-right">SignedGross</th><th>Client</th><th>Project</th><th>Director</th><th>L0</th><th>L1</th></tr></thead>
          <tbody>
            {calc.map((c, i) => (
              <tr key={rows[i].id}>
                <td>{String(c.DocNo ?? "")}</td><td>{String(c.Head ?? "")}</td><td>{String(c.ExpType ?? "")}</td><td className="text-right">{fmtNum(c.SignedGross)}</td>
                <td>{String(c.Client ?? "")}</td><td>{String(c.Project ?? "")}</td><td>{String(c.Director ?? "")}</td>
                <td className="text-xs">{String(c.L0_Emp ?? "")} {c.L0_Emp ? fmtNum(c.L0_Amt) : ""}</td><td className="text-xs">{String(c.L1_Emp ?? "")} {c.L1_Emp ? fmtNum(c.L1_Amt) : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
