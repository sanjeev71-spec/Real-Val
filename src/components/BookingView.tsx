import { DISCOUNT_KEYS, VIEW_SECTIONS } from "@/lib/fields";
import { fmtCell } from "@/lib/format";

function Item({ label, k, row }: { label: string; k: string; row: Record<string, unknown> }) {
  return (
    <div className="flex justify-between gap-3 border-b border-dashed border-[var(--line)] py-1 text-sm">
      <dt className="text-[var(--muted)]">{label}</dt>
      <dd className="text-right font-medium">{fmtCell(k, row[k]) || "—"}</dd>
    </div>
  );
}

export function BookingView({ row: raw, note }: { row: Record<string, unknown>; note?: string }) {
  const row = {
    ...raw,
    "Total DiscountPSF": DISCOUNT_KEYS.reduce((s, k) => s + (typeof raw[k] === "number" ? (raw[k] as number) : 0), 0),
  };
  return (
    <div className="space-y-4">
      {note && <p className="text-xs text-[var(--muted)]">{note}</p>}
      {VIEW_SECTIONS.map((sec) => (
        <section key={sec.title} className="card">
          <h2 className="h2">{sec.title}</h2>
          {sec.columns && (
            <div className="grid grid-cols-1 gap-x-6 gap-y-2 md:grid-cols-3">
              {sec.columns.map((col, i) => (
                <dl key={i}>{col.map((c) => <Item key={c.key} label={c.label} k={c.key} row={row} />)}</dl>
              ))}
            </div>
          )}
          {sec.keys.length > 0 && (
            <dl className={`grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-3 ${sec.columns ? "mt-4" : ""}`}>
              {sec.keys.map((k, i) => (k === "" ? <div key={`gap${i}`} className="hidden lg:block" /> : <Item key={k} label={k} k={k} row={row} />))}
            </dl>
          )}
        </section>
      ))}
    </div>
  );
}
