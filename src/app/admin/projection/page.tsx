import { asc } from "drizzle-orm";
import { requireUser } from "@/lib/auth";
import { getDb, schema as s } from "@/lib/db";
import { projectionRows, projectionYears, todayIso } from "@/lib/data";
import { ProjectionEditor } from "@/components/ProjectionEditor";

export const dynamic = "force-dynamic";

export default async function ProjectionAdmin({ searchParams }: { searchParams: Promise<{ year?: string }> }) {
  await requireUser(["master"]);
  const q = await searchParams;
  const year = Number(q.year) || Number(todayIso().slice(0, 4));
  const db = await getDb();
  const [rows, years, emps] = await Promise.all([projectionRows(year), projectionYears(), db.select({ emp: s.employees.emp }).from(s.employees).orderBy(asc(s.employees.emp))]);
  const seen = new Set<string>();
  const people = emps.flatMap((e) => {
    const code = e.emp.split("~")[1] ?? "";
    if (!code || seen.has(code.toLowerCase())) return [];
    seen.add(code.toLowerCase());
    return [{ code, name: e.emp }];
  });
  const fmt = (v: number | null) => (v === null ? "" : String(v));
  return (
    <div className="space-y-4">
      <h1 className="h1">Projection targets — {year}</h1>
      <p className="text-sm text-[var(--muted)]">
        One row per employee: the <b>yearly</b> target for man-months, booking count and DirectorRevenue. The Projection report spreads each equally over the 12 months.
        The same employee can have more than one row (use Remarks, e.g. Channel).
      </p>
      <ProjectionEditor
        key={year} year={year} years={years} people={people}
        initial={rows.map((r) => ({ empCode: r.empCode, manMonths: fmt(r.manMonths), bkgCount: fmt(r.bkgCount), directorRevenue: fmt(r.directorRevenue), remarks: r.remarks ?? "" }))}
      />
    </div>
  );
}
