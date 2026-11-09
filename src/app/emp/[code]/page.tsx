import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { currentPeriods, employeesWithCalc } from "@/lib/data";
import { fmtDate, fmtNum } from "@/lib/format";
import { PERSON_FIELDS } from "@/lib/empFields";
import { EmpEditor } from "@/components/EmpEditor";

export const dynamic = "force-dynamic";

const TABS = [
  ["", "History"],
  ["change", "Effective change"],
  ["correct", "Correct details"],
  ["exit", "Exit"],
] as const;

export default async function EmpPage({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: Promise<{ tab?: string }> }) {
  const user = await requireUser(["hr", "master"]);
  const code = decodeURIComponent((await params).code);
  const { tab = "" } = await searchParams;
  const all = await employeesWithCalc();
  const periods = all.filter((r) => (r.emp.split("~")[1] ?? "").toLowerCase() === code.toLowerCase()).sort((a, b) => b.changeDateFrom.localeCompare(a.changeDateFrom));
  if (!periods.length) notFound();
  const cur = periods[0];
  const exited = cur.changeDateTo !== null;
  const names = [...new Set(all.map((r) => r.emp))].sort();
  const reportees = currentPeriods(all).filter((r) => r.changeDateTo === null && r.reportingHead === cur.emp && r.emp !== cur.emp).map((r) => r.emp);
  const { calc: _c, ...current } = cur;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="h1">{cur.emp}</h1>
        <span className={`pill ${exited ? "bg-slate-200" : "bg-green-100 text-green-800"}`}>{exited ? `Left ${fmtDate(cur.changeDateTo)}` : "Active"}</span>
      </div>
      <nav className="flex flex-wrap gap-2">
        {TABS.filter(([t]) => !exited || t === "" || t === "correct").map(([t, label]) => (
          <Link key={t} className={`btn ${tab === t ? "btn-primary" : ""}`} href={`/emp/${encodeURIComponent(code)}${t ? `?tab=${t}` : ""}`}>{label}</Link>
        ))}
      </nav>

      {tab === "" && (
        <>
          <section className="card overflow-x-auto">
            <h2 className="h2">Periods</h2>
            <table className="table">
              <thead><tr><th>From</th><th>To</th><th>Reporting head</th><th>Director</th><th>Branch</th><th>Type</th><th>Designation</th><th>RevShare</th><th>ExpShare</th><th>Days</th><th className="text-right">Seat cost</th></tr></thead>
              <tbody>
                {periods.map((p) => (
                  <tr key={p.id}>
                    <td>{fmtDate(p.changeDateFrom)}</td><td>{p.changeDateTo ? fmtDate(p.changeDateTo) : "current"}</td>
                    <td>{p.reportingHead}</td><td>{p.calc.director}</td><td>{p.branch}</td><td>{p.type}</td><td>{p.designation}</td>
                    <td>{p.revShare ?? ""}</td><td>{p.expShare ?? ""}</td><td>{p.calc.daysWorked}</td><td className="text-right">{fmtNum(p.calc.seatCost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
          <section className="card">
            <h2 className="h2">Personal details (Master & HR only)</h2>
            <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
              {PERSON_FIELDS.map((f) => (
                <div key={f.key} className="flex justify-between gap-3 border-b border-dashed border-[var(--line)] py-1 text-sm">
                  <dt className="text-[var(--muted)]">{f.label}</dt>
                  <dd className="text-right font-medium">{(f.type === "date" ? fmtDate((cur as never)[f.key]) : String((cur as never)[f.key] ?? "")) || "—"}</dd>
                </div>
              ))}
            </dl>
          </section>
          {reportees.length > 0 && (
            <section className="card text-sm"><b>Reports to them now:</b> {reportees.join(", ")}</section>
          )}
        </>
      )}
      {tab === "change" && !exited && <EmpEditor mode="change" role={user.role} employees={names} current={current as never} />}
      {tab === "correct" && <EmpEditor mode="correct" role={user.role} employees={names} current={current as never} />}
      {tab === "exit" && !exited && <EmpEditor mode="exit" role={user.role} employees={names} current={current as never} reportees={reportees} />}
    </div>
  );
}
