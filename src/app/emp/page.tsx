import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { currentPeriods, employeesWithCalc } from "@/lib/data";
import { fmtDate } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function EmpList({ searchParams }: { searchParams: Promise<{ q?: string; all?: string }> }) {
  await requireUser(["hr", "master"]);
  const { q = "", all } = await searchParams;
  const rows = currentPeriods(await employeesWithCalc());
  const n = q.trim().toLowerCase();
  const shown = rows
    .filter((r) => all || r.changeDateTo === null)
    .filter((r) => !n || [r.emp, r.reportingHead, r.calc.director, r.branch, r.designation].some((x) => String(x ?? "").toLowerCase().includes(n)));
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="h1">Employees (Emp)</h1>
        <span className="text-sm text-[var(--muted)]">{shown.length} shown</span>
        <a className="btn ml-auto" href="/api/export/emp">Download Emp (.xlsx)</a>
        <Link className="btn btn-primary" href="/emp/new">+ New employee</Link>
      </div>
      <form className="flex flex-wrap items-center gap-2">
        <input name="q" defaultValue={q} className="input max-w-md" placeholder="Search name, code, reporting head, director, branch…" />
        <label className="flex items-center gap-1 text-sm"><input type="checkbox" name="all" value="1" defaultChecked={!!all} /> include people who left</label>
        <button className="btn btn-primary">Search</button>
      </form>
      <div className="card overflow-x-auto">
        <table className="table">
          <thead><tr><th>Employee</th><th>Reporting head</th><th>Director</th><th>Branch</th><th>Type</th><th>Designation</th><th>RevShare</th><th>ExpShare</th><th>Since</th><th>Left on</th></tr></thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.id}>
                <td><Link className="text-[var(--brand)] underline" href={`/emp/${encodeURIComponent(r.emp.split("~")[1] ?? "")}`}>{r.emp}</Link></td>
                <td>{r.reportingHead}</td>
                <td>{r.calc.director}</td>
                <td>{r.branch}</td>
                <td>{r.type}</td>
                <td>{r.designation}</td>
                <td>{r.revShare ?? ""}</td>
                <td>{r.expShare ?? ""}</td>
                <td>{fmtDate(r.changeDateFrom)}</td>
                <td>{fmtDate(r.changeDateTo)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
