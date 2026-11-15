import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { expWithCalc } from "@/lib/data";
import { fmtDate, fmtNum } from "@/lib/format";
import { Pager } from "@/components/Pager";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const SEARCH_KEYS = ["DocNo", "Head", "Mode", "BkgID", "Emp", "Client", "Project", "Director", "Narration", "Chq/UTR No", "Bank Name", "Purpose"];
const text = (v: unknown) => String(v ?? "");
const nameOnly = (v: unknown) => text(v).split("~")[0];

export default async function ExpList({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireUser(["admin", "master"]);
  const q = await searchParams;
  const size = [50, 100, 250].includes(Number(q.size)) ? Number(q.size) : 100;
  const all = await expWithCalc();
  const term = (q.q ?? "").trim().toLowerCase();
  const matched = term ? all.filter((r) => SEARCH_KEYS.some((k) => text(r[k]).toLowerCase().includes(term))) : all;
  const pages = Math.max(1, Math.ceil(matched.length / size));
  const page = Math.min(pages, Math.max(1, Number(q.page) || 1));
  const rows = matched.slice((page - 1) * size, page * size);
  const params: Record<string, string> = term ? { q: q.q!.trim() } : {};

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="h1">Exp</h1>
        <span className="text-sm text-[var(--muted)]">{matched.length.toLocaleString("en-IN")} of {all.length.toLocaleString("en-IN")} lines · newest first</span>
        <a className="btn ml-auto" href="/api/export/exp">Download Excel</a>
        <Link className="btn btn-primary" href="/exp/new">+ New document</Link>
      </div>
      <form method="get" className="flex max-w-2xl gap-2">
        <input name="q" defaultValue={q.q ?? ""} className="input" placeholder="Search document, head, BkgID, employee, client, UTR…" />
        <input type="hidden" name="size" value={size} />
        <button className="btn btn-primary">Search</button>
        {term && <Link className="btn" href="/exp">Clear</Link>}
      </form>
      <div className="tablewrap">
        <table className="table">
          <thead>
            <tr><th>DocNo</th><th>Pay date</th><th>Head</th><th>Mode</th><th>R/P</th><th className="text-right">Gross</th><th>Chq / UTR</th><th>BkgID</th><th>Employee</th><th>Director</th><th>L0</th><th>L1</th></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td><Link className="link" href={`/exp/${r.id}`}>{text(r.DocNo || r.id)}</Link></td>
                <td>{fmtDate(r.PayDate)}</td>
                <td>{text(r.Head)}</td>
                <td>{text(r.Mode)}</td>
                <td><span className={`pill ${r["R/P"] === "Receipt" ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}`}>{text(r["R/P"])}</span></td>
                <td className="text-right">{fmtNum(r.Gross)}</td>
                <td><span className="cell-trunc" title={text(r["Chq/UTR No"])}>{text(r["Chq/UTR No"])}{r["Bank Name"] ? ` · ${text(r["Bank Name"])}` : ""}</span></td>
                <td>{r.BkgID ? <Link className="link" href={`/bookings/${encodeURIComponent(text(r.BkgID))}`}>{text(r.BkgID)}</Link> : ""}</td>
                <td><span className="cell-trunc" title={text(r.Emp)}>{nameOnly(r.Emp)}</span></td>
                <td><span className="cell-trunc" title={text(r.Director)}>{nameOnly(r.Director)}</span></td>
                <td className="text-xs"><span className="cell-trunc">{nameOnly(r.L0_Emp)} {r.L0_Emp ? fmtNum(r.L0_Amt) : ""}</span></td>
                <td className="text-xs"><span className="cell-trunc">{nameOnly(r.L1_Emp)} {r.L1_Emp ? fmtNum(r.L1_Amt) : ""}</span></td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={12} className="py-6 text-center text-[var(--muted)]">No entries.</td></tr>}
          </tbody>
        </table>
      </div>
      <Pager base="/exp" params={params} page={page} pages={pages} total={matched.length} size={size} />
    </div>
  );
}
