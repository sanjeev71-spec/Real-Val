// Booking events (booked, cancelled, RA closed, revised ...) with the month each counts in. Master / Admin can change that date.
import Link from "next/link";
import { setEventDateAction } from "@/app/actions";
import { KIND_LABEL, type eventGroups } from "@/lib/bookingEvents";
import { fmtDate } from "@/lib/format";

type Group = Awaited<ReturnType<typeof eventGroups>>[number];
const money = (v: number) => (Math.round(v) === 0 ? "" : `${v < 0 ? "−" : "+"}₹${Math.abs(Math.round(v)).toLocaleString("en-IN")}`);
const TONE: Record<string, string> = { cancel: "bg-red-100 text-red-800", deleted: "bg-red-100 text-red-800", booked: "bg-green-100 text-green-800", reinstate: "bg-green-100 text-green-800", ra_close: "bg-violet-100 text-violet-800" };

export function EventTable({ groups, canEdit, showBooking = false }: { groups: Group[]; canEdit: boolean; showBooking?: boolean }) {
  if (!groups.length) return <p className="text-sm text-[var(--muted)]">No events yet.</p>;
  return (
    <table className="table">
      <thead>
        <tr>
          {showBooking && <th>Booking</th>}
          <th>Counts in (effective date)</th><th>Event</th><th>What</th>
          <th className="text-right">Revenue</th><th className="text-right">ShareAmt</th><th className="text-right">ShareAmt × RA%</th><th>Director(s)</th><th>Captured on</th>
        </tr>
      </thead>
      <tbody>
        {groups.map((g) => {
          const t = g.parts.reduce((a, p) => ({ rev: a.rev + p.rev, share: a.share + p.share, shareRA: a.shareRA + p.shareRA }), { rev: 0, share: 0, shareRA: 0 });
          return (
            <tr key={g.grp} className={g.dateConfirmed ? "" : "bg-amber-50"}>
              {showBooking && <td><Link className="text-[var(--brand)] underline" href={`/bookings/${encodeURIComponent(g.bkgId)}`}>{g.bkgId}</Link></td>}
              <td className="whitespace-nowrap">
                {canEdit ? (
                  <form action={setEventDateAction} className="flex items-center gap-1">
                    <input type="hidden" name="grp" value={g.grp} />
                    <input type="date" name="date" defaultValue={g.effectiveDate} className="input !w-auto !py-0.5 text-xs" />
                    <button className="btn !px-2 !py-0.5 text-xs">{g.dateConfirmed ? "Save" : "Confirm"}</button>
                  </form>
                ) : fmtDate(g.effectiveDate)}
                {!g.dateConfirmed && <div className="text-[11px] text-amber-700">guessed - please confirm</div>}
                {g.originalEffective && g.originalEffective !== g.effectiveDate && <div className="text-[11px] text-[var(--muted)]">first {fmtDate(g.originalEffective)}</div>}
              </td>
              <td><span className={`pill ${TONE[g.kind] ?? "bg-slate-100"}`}>{KIND_LABEL[g.kind] ?? g.kind}</span></td>
              <td className="text-xs">{g.detail}</td>
              <td className={`text-right ${t.rev < 0 ? "text-red-700" : ""}`}>{money(t.rev)}</td>
              <td className={`text-right ${t.share < 0 ? "text-red-700" : ""}`}>{money(t.share)}</td>
              <td className={`text-right ${t.shareRA < 0 ? "text-red-700" : ""}`}>{money(t.shareRA)}</td>
              <td className="text-xs">{[...new Set(g.parts.map((p) => (p.director ?? "").split("~")[0]))].join(", ")}</td>
              <td className="whitespace-nowrap text-xs">{fmtDate(g.capturedOn)}{g.source === "history" ? " (history)" : ""}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
