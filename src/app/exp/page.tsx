import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { activeModes, expHeadList, expWithCalc } from "@/lib/data";
import { EXP_FILTER_KEYS, EXP_TEXT_FILTERS, filterExp } from "@/lib/expFilter";
import { Pager } from "@/components/Pager";
import { ExpTable } from "@/components/ExpTable";
import { MergeBar } from "@/components/MergeBar";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export default async function ExpList({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireUser(["admin", "master"]);
  const q = await searchParams;
  const size = [50, 100, 250].includes(Number(q.size)) ? Number(q.size) : 100;
  const [all, heads, modes] = await Promise.all([expWithCalc(), expHeadList(), activeModes()]);
  const matched = filterExp(all, q);
  const pages = Math.max(1, Math.ceil(matched.length / size));
  const page = Math.min(pages, Math.max(1, Number(q.page) || 1));
  const rows = matched.slice((page - 1) * size, page * size);
  const params: Record<string, string> = {};
  for (const k of EXP_FILTER_KEYS) if ((q[k] ?? "").trim()) params[k] = q[k]!.trim();
  const filtered = Object.keys(params).length > 0;
  const exportHref = `/api/export/exp?${new URLSearchParams(params)}`;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="h1">Exp</h1>
        <span className="text-sm text-[var(--muted)]">{matched.length.toLocaleString("en-IN")} of {all.length.toLocaleString("en-IN")} lines · latest pay date first</span>
        <a className="btn ml-auto" href={exportHref}>Download Excel{filtered ? " (this search)" : ""}</a>
        <Link className="btn btn-primary" href="/exp/new">+ New document</Link>
      </div>

      <form method="get" className="card py-3">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
          <div>
            <label className="label" htmlFor="f-head">Head</label>
            <select id="f-head" name="head" className="input" defaultValue={q.head ?? ""}>
              <option value="">All</option>{heads.map((h) => <option key={h.head} value={h.head}>{h.head}</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="f-mode">Mode</label>
            <select id="f-mode" name="mode" className="input" defaultValue={q.mode ?? ""}>
              <option value="">All</option>{modes.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="f-rp">R/P</label>
            <select id="f-rp" name="rp" className="input" defaultValue={q.rp ?? ""}>
              <option value="">All</option><option>Receipt</option><option>Payment</option>
            </select>
          </div>
          <div>
            <label className="label" htmlFor="f-gross">Gross amt</label>
            <input id="f-gross" name="gross" className="input" placeholder="5000 · >5000 · 1000-5000" defaultValue={q.gross ?? ""} />
          </div>
          <div>
            <label className="label" htmlFor="f-from">Pay date from</label>
            <input id="f-from" name="from" type="date" className="input" defaultValue={q.from ?? ""} />
          </div>
          <div>
            <label className="label" htmlFor="f-to">Pay date to</label>
            <input id="f-to" name="to" type="date" className="input" defaultValue={q.to ?? ""} />
          </div>
          {EXP_TEXT_FILTERS.map(([k, label]) => (
            <div key={k}>
              <label className="label" htmlFor={`f-${k}`}>{label}</label>
              <input id={`f-${k}`} name={k} className="input" placeholder="contains…" defaultValue={q[k] ?? ""} />
            </div>
          ))}
          <div className="flex items-end gap-2">
            <input type="hidden" name="size" value={size} />
            <button className="btn btn-primary">Search</button>
            {filtered && <Link className="btn" href="/exp">Clear</Link>}
          </div>
        </div>
      </form>

      <ExpTable rows={rows} selectable />
      <MergeBar />
      <Pager base="/exp" params={params} page={page} pages={pages} total={matched.length} size={size} />
    </div>
  );
}
