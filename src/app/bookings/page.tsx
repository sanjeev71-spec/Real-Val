import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { computedBookings } from "@/lib/data";
import { fmtDate, fmtNum } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function Bookings({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const user = await requireUser(["master", "admin", "sales"]);
  const { q = "" } = await searchParams;
  const all = await computedBookings();
  const mine = user.role === "sales" ? all.filter((r) => r.Emp === user.empCode) : all;
  const needle = q.trim().toLowerCase();
  const rows = needle
    ? mine.filter((r) =>
        ["BkgID", "Client", "ContactNo", "Mobile2", "UnitNo", "Project", "Emp", "Director", "BuilderUID"].some((k) =>
          String(r[k] ?? "").toLowerCase().includes(needle),
        ),
      )
    : mine;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="h1">Bookings</h1>
        <span className="text-sm text-[var(--muted)]">{rows.length} of {mine.length}</span>
        <a className="btn ml-auto" href={`/api/export${needle ? `?q=${encodeURIComponent(q)}` : ""}`}>Download Bkg (.xlsx, all 120 columns)</a>
      </div>
      <form className="flex gap-2">
        <input name="q" defaultValue={q} className="input max-w-md" placeholder="Search BkgID, client, mobile, unit, project, associate…" />
        <button className="btn btn-primary">Search</button>
      </form>
      <div className="card overflow-x-auto">
        <table className="table">
          <thead>
            <tr><th>BkgID</th><th>Date</th><th>Status</th><th>Client</th><th>Project / unit</th><th>Associate</th><th>Director</th>
              <th className="text-right">TC incl. GST</th><th className="text-right">Recd</th><th className="text-right">CoRev</th></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={String(r.BkgID)}>
                <td><Link className="text-[var(--brand)] underline" href={`/bookings/${r.BkgID}`}>{String(r.BkgID)}</Link></td>
                <td>{fmtDate(r.BkgLoginDate)}</td>
                <td>{String(r.FormStatus ?? "")}</td>
                <td>{String(r.Client ?? "")}</td>
                <td>{String(r.Project ?? "")} {String(r.UnitNo ?? "")}</td>
                <td>{String(r.Emp ?? "")}</td>
                <td>{String(r.Director ?? "")}</td>
                <td className="text-right">{fmtNum(r.TCWithGST)}</td>
                <td className="text-right">{fmtNum(r.TotalRecdAmt)}</td>
                <td className="text-right">{fmtNum(r.CoRev)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
