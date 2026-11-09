import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { expWithCalc } from "@/lib/data";
import { fmtDate, fmtNum } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function ExpList({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  await requireUser(["admin", "master"]);
  const { q = "" } = await searchParams;
  const all = await expWithCalc();
  const n = q.trim().toLowerCase();
  const rows = n
    ? all.filter((r) => ["DocNo", "Head", "Mode", "BkgID", "Emp", "Client", "Project", "Director", "Narration"].some((k) => String(r[k] ?? "").toLowerCase().includes(n)))
    : all;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="h1">Exp (receipts & payments)</h1>
        <span className="text-sm text-[var(--muted)]">{rows.length} of {all.length}</span>
        <a className="btn ml-auto" href="/api/export/exp">Download Exp (.xlsx)</a>
        <Link className="btn btn-primary" href="/exp/new">+ New entry</Link>
      </div>
      <form className="flex gap-2">
        <input name="q" defaultValue={q} className="input max-w-md" placeholder="Search DocNo, head, BkgID, employee, client…" />
        <button className="btn btn-primary">Search</button>
      </form>
      <div className="card overflow-x-auto">
        <table className="table">
          <thead>
            <tr><th>DocNo</th><th>Pay date</th><th>Head</th><th>Mode</th><th>R/P</th><th className="text-right">Gross</th><th>BkgID</th><th>Employee</th><th>Director</th><th>L0</th><th>L1</th></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td><Link className="text-[var(--brand)] underline" href={`/exp/${r.id}`}>{String(r.DocNo ?? r.id)}</Link></td>
                <td>{fmtDate(r.PayDate)}</td>
                <td>{String(r.Head ?? "")}</td>
                <td>{String(r.Mode ?? "")}</td>
                <td>{String(r["R/P"] ?? "")}</td>
                <td className="text-right">{fmtNum(r.Gross)}</td>
                <td>{r.BkgID ? <Link className="underline" href={`/bookings/${r.BkgID}`}>{String(r.BkgID)}</Link> : ""}</td>
                <td>{String(r.Emp ?? "")}</td>
                <td>{String(r.Director ?? "")}</td>
                <td className="text-xs">{String(r.L0_Emp ?? "")} {r.L0_Emp ? fmtNum(r.L0_Amt) : ""}</td>
                <td className="text-xs">{String(r.L1_Emp ?? "")} {r.L1_Emp ? fmtNum(r.L1_Amt) : ""}</td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={11} className="text-[var(--muted)]">No entries.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
