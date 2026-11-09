import { VIEW_SECTIONS } from "@/lib/fields";
import { fmtCell } from "@/lib/format";

export function BookingView({ row, note }: { row: Record<string, unknown>; note?: string }) {
  return (
    <div className="space-y-4">
      {note && <p className="text-xs text-[var(--muted)]">{note}</p>}
      {VIEW_SECTIONS.map((sec) => (
        <section key={sec.title} className="card">
          <h2 className="h2">{sec.title}</h2>
          <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
            {sec.keys.map((k) => (
              <div key={k} className="flex justify-between gap-3 border-b border-dashed border-[var(--line)] py-1 text-sm">
                <dt className="text-[var(--muted)]">{k}</dt>
                <dd className="text-right font-medium">{fmtCell(k, row[k]) || "—"}</dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </div>
  );
}
