import Link from "next/link";

/** Previous / next and a few page numbers, keeping the current filters in the link. */
export function Pager({ base, params, page, pages, total, size }: { base: string; params: Record<string, string>; page: number; pages: number; total: number; size: number }) {
  const href = (p: number, s = size) => {
    const q = new URLSearchParams({ ...params, page: String(p), size: String(s) });
    return `${base}?${q.toString()}`;
  };
  const nums: number[] = [];
  for (let p = Math.max(1, page - 2); p <= Math.min(pages, page + 2); p++) nums.push(p);
  const from = total === 0 ? 0 : (page - 1) * size + 1;
  const to = Math.min(total, page * size);
  const cls = "btn h-7 px-2.5";
  return (
    <div className="flex flex-wrap items-center gap-2 text-[13px] text-[var(--muted)]">
      <span>{from}–{to} of {total.toLocaleString("en-IN")}</span>
      <span className="ml-auto flex flex-wrap items-center gap-1">
        {page > 1 ? <Link className={cls} href={href(1)}>«</Link> : null}
        {page > 1 ? <Link className={cls} href={href(page - 1)}>‹ Prev</Link> : null}
        {nums.map((p) => <Link key={p} className={`${cls} ${p === page ? "btn-primary" : ""}`} href={href(p)}>{p}</Link>)}
        {page < pages ? <Link className={cls} href={href(page + 1)}>Next ›</Link> : null}
        {page < pages ? <Link className={cls} href={href(pages)}>»</Link> : null}
        <span className="mx-1">Rows</span>
        {[50, 100, 250].map((n) => <Link key={n} className={`${cls} ${n === size ? "btn-primary" : ""}`} href={href(1, n)}>{n}</Link>)}
      </span>
    </div>
  );
}
