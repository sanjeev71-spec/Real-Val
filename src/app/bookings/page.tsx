import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { computedBookings } from "@/lib/data";
import { Pager } from "@/components/Pager";
import { BkgTable } from "@/components/BkgTable";
import { BKG_TEXT_FIELDS, activeBkgFilters, filterBkg, sortBkgByDate } from "@/lib/bkgFilter";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const FIELDS = BKG_TEXT_FIELDS;
const EXTRA_LABEL: Record<string, string> = { sold: "Live + Not Live", month: "Month", from: "From", to: "To", branch: "Branch", due: "Pending due", bill: "Billed, not received" };

export default async function Bookings({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireUser(["master", "admin", "sales"]);
  const q = await searchParams;
  const size = [50, 100, 250].includes(Number(q.size)) ? Number(q.size) : 100;
  const all = await computedBookings();
  const mine = user.role === "sales" ? all.filter((r) => r.Emp === user.empCode) : all;

  const get = (k: string) => q[k];
  const shown = sortBkgByDate(filterBkg(mine, get), "desc"); // latest Bkg Date on top
  const statuses = [...new Set(mine.map((r) => String(r.FormStatus ?? "").trim()).filter(Boolean))].sort();
  const active = activeBkgFilters(get);
  const extra = active.filter(([k]) => k in EXTRA_LABEL);
  const pages = Math.max(1, Math.ceil(shown.length / size));
  const page = Math.min(pages, Math.max(1, Number(q.page) || 1));
  const rows = shown.slice((page - 1) * size, page * size);
  const params = Object.fromEntries(active);
  const exportHref = `/api/export?${new URLSearchParams(params)}`;
  const terms = active;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="h1">Bkg</h1>
        <span className="text-sm text-[var(--muted)]">{shown.length.toLocaleString("en-IN")} of {mine.length.toLocaleString("en-IN")} bookings</span>
        <a className="btn ml-auto" href={exportHref}>Download Excel{terms.length ? " (this search)" : ""}</a>
      </div>

      <form method="get" className="card flex flex-wrap items-end gap-3 py-3">
        {FIELDS.map(([k, label]) => (
          <div key={k} className="min-w-[9rem] flex-1">
            <label className="label" htmlFor={`s-${k}`}>{label}</label>
            <input id={`s-${k}`} name={k} className="input" placeholder="contains…" defaultValue={q[k] ?? ""} />
          </div>
        ))}
        <div className="min-w-[9rem] flex-1">
          <label className="label" htmlFor="s-status">FormStatus</label>
          <select id="s-status" name="status" className="input" defaultValue={q.status ?? ""}>
            <option value="">All</option>{statuses.map((x) => <option key={x}>{x}</option>)}
          </select>
        </div>
        <input type="hidden" name="size" value={size} />
        {extra.map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
        <button className="btn btn-primary">Search</button>
        {terms.length > 0 && <Link className="btn" href="/bookings">Clear</Link>}
      </form>

      {extra.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-[var(--muted)]">Showing:</span>
          {extra.map(([k, v]) => <span key={k} className="rounded-full bg-slate-100 px-2.5 py-1">{EXTRA_LABEL[k]}{v === "1" ? "" : `: ${v}`}</span>)}
        </div>
      )}

      <BkgTable rows={rows} />
      <Pager base="/bookings" params={params} page={page} pages={pages} total={shown.length} size={size} />
    </div>
  );
}
