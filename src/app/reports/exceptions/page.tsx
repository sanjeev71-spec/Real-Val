import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { getDb, schema as s } from "@/lib/db";
import { loadCore } from "@/lib/data";
import { findExceptions } from "@/lib/calc/exceptions";
import { fmtNum } from "@/lib/format";
import { BkgTable } from "@/components/BkgTable";
import { ExpTable } from "@/components/ExpTable";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const TONE = { high: "bg-red-100 text-red-800", medium: "bg-amber-100 text-amber-800", low: "bg-slate-100 text-slate-700" } as const;
const SHOW = 100; // rows shown per check on the page (the download has all of them)

export default async function Exceptions() {
  await requireUser(["master", "admin"]);
  const db = await getDb();
  const [{ bk, exps }, emps, heads] = await Promise.all([
    loadCore(),
    db.selectDistinct({ emp: s.employees.emp }).from(s.employees),
    db.select({ head: s.expHeads.head }).from(s.expHeads),
  ]);
  const groups = findExceptions(bk as never, exps as never, new Set(emps.map((e) => e.emp)), new Set(heads.map((h) => h.head.toLowerCase())));
  const total = groups.reduce((a, g) => a + g.count, 0);
  return (
    <div className="space-y-4">
      <div>
        <h1 className="h1">Data exceptions</h1>
        <p className="text-sm text-[var(--muted)]">
          Records that look incomplete or inconsistent, shown and downloaded exactly like the Exp and Bkg lists. Open an item, correct it, and it disappears from this list.
          {" "}{groups.length ? <><b>{fmtNum(total)}</b> item(s) in {groups.length} check(s).</> : "Nothing found — the data is clean."}
          {" "}For merging duplicate names and similar fixes, see <Link className="link" href="/admin/cleanup">Clean-up</Link>.
        </p>
      </div>
      {groups.length > 0 && (
        <nav className="card flex flex-wrap gap-2 py-3">
          {groups.map((g) => <a key={g.key} href={`#${g.key}`} className="rounded-full border border-[var(--line)] px-3 py-1 text-xs hover:bg-slate-50">{g.title} <b>{fmtNum(g.count)}</b></a>)}
        </nav>
      )}
      {groups.map((g) => (
        <section key={g.key} id={g.key} className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="h2 mb-0">{g.title}</h2>
            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${TONE[g.severity]}`}>{g.severity}</span>
            <span className="text-sm font-semibold">{fmtNum(g.count)}</span>
            <a className="btn ml-auto" href={`/api/export/exceptions?key=${g.key}`}>Download Excel ({g.kind === "bkg" ? "Bkg" : "Exp"} format)</a>
          </div>
          <p className="text-xs text-[var(--muted)]">{g.why}{g.count > SHOW ? ` Showing the first ${SHOW}; the download has all ${fmtNum(g.count)}.` : ""}</p>
          {g.kind === "bkg" ? <BkgTable rows={g.rows.slice(0, SHOW)} /> : <ExpTable rows={g.rows.slice(0, SHOW) as never} />}
        </section>
      ))}
    </div>
  );
}
