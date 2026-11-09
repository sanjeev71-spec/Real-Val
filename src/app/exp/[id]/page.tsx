import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth";
import { getDb, schema as s } from "@/lib/db";
import { expContext, expFormData, expInputOf } from "@/lib/data";
import { computeExp } from "@/lib/calc/exp";
import { fmtCell } from "@/lib/format";
import { ExpForm } from "@/components/ExpForm";

export const dynamic = "force-dynamic";

export default async function ExpEntry({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser(["admin", "master"]);
  const id = Number((await params).id);
  const db = await getDb();
  const [e] = await db.select().from(s.expEntries).where(eq(s.expEntries.id, id));
  if (!e) notFound();
  const [f, ctx] = await Promise.all([expFormData(), expContext()]);
  const c = computeExp(expInputOf(e), ctx);
  const initial = {
    payDate: e.payDate, valueDate: e.valueDate, head: e.head, mode: e.mode, rp: e.rp, gross: e.gross, gst: e.gst, tds: e.tds,
    branch: e.branch, bkgId: e.bkgId, emp: e.emp ?? (c.Emp as string), project: e.project, narration: e.narration, remarks: e.remarks,
  };
  return (
    <div className="space-y-4">
      <h1 className="h1">Exp {e.docNo}</h1>
      <section className="card">
        <h2 className="h2">Calculated</h2>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-4">
          {["ExpType", "SignedGross", "Rcv_NetBill", "Client", "Project", "Director", "L0_Emp", "L0_Amt", "L1_Emp", "L1_Amt", "Rcv_Status"].map((k) => (
            <div key={k} className="flex justify-between gap-3 border-b border-dashed border-[var(--line)] py-1 text-sm">
              <dt className="text-[var(--muted)]">{k}</dt><dd className="font-medium">{fmtCell(k, c[k]) || "—"}</dd>
            </div>
          ))}
        </dl>
      </section>
      <p className="text-sm text-[var(--muted)]">{user.role === "master" ? "Changes are saved immediately." : "Edits and deletions go to the Master for approval."}</p>
      <ExpForm role={user.role} {...f} initial={initial} targetId={id} />
    </div>
  );
}
