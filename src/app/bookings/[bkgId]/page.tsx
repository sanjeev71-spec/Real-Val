import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { computedBookings } from "@/lib/data";
import Link from "next/link";
import { bkgHistory } from "@/lib/bkgHistory";
import { BookingView } from "@/components/BookingView";
import { EventTable } from "@/components/EventTable";
import { eventGroups, syncBookingEventsQuietly } from "@/lib/bookingEvents";

export const dynamic = "force-dynamic";

export default async function BookingPage({ params, searchParams }: { params: Promise<{ bkgId: string }>; searchParams: Promise<{ saved?: string }> }) {
  const user = await requireUser(["master", "admin", "sales"]);
  const { bkgId } = await params;
  const saved = (await searchParams).saved === "1";
  const row = (await computedBookings()).find((r) => String(r.BkgID).toUpperCase() === decodeURIComponent(bkgId).toUpperCase());
  if (!row || (user.role === "sales" && row.Emp !== user.empCode)) notFound();
  const history = user.role === "sales" ? null : await bkgHistory(String(row.BkgID));
  if (user.role !== "sales") await syncBookingEventsQuietly(); // pick up anything not yet recorded
  const events = user.role === "sales" ? null : await eventGroups({ bkgId: String(row.BkgID) });
  return (
    <div className="space-y-4">
      {saved && <div className="card border-green-300 bg-green-50 text-sm">Saved - the change is logged under Exp/Emp/Bkg approvals.</div>}
      {user.role !== "sales" && (
        <div className="flex justify-end"><Link className="btn btn-primary" href={`/bookings/${encodeURIComponent(String(row.BkgID))}/edit`}>Edit this booking</Link></div>
      )}
      <h1 className="h1 overflow-x-auto whitespace-nowrap !text-base font-bold leading-snug sm:!text-[17px]">
        {[row.BkgID, row.Client, row.Builder, row.Project, row.UnitNo].map((x) => String(x ?? "").trim()).filter(Boolean).join(" ~ ")}
      </h1>
      <BookingView row={row} />
      {events && (
        <section className="card overflow-x-auto">
          <h2 className="h2">Events (month by month)</h2>
          <p className="mb-2 text-xs text-[var(--muted)]">What happened to this booking and the month each change counts in for the monthly movement report. The captured date is when the site saw the change; the effective date can be corrected.</p>
          <EventTable groups={events} canEdit />
        </section>
      )}
      {history && (
        <section className="card overflow-x-auto">
          <h2 className="h2">History of this booking</h2>
          {history.length === 0 ? <p className="text-sm text-[var(--muted)]">No change has been made to this booking through the system (upload or form edit).</p> : (
            <table className="table">
              <thead><tr><th>When</th><th>What</th><th>By</th><th>Decision</th><th>Comment</th><th></th></tr></thead>
              <tbody>
                {history.map((h) => (
                  <tr key={h.id}>
                    <td className="whitespace-nowrap">{h.createdAt.slice(0, 16).replace("T", " ")}</td>
                    <td className="text-xs">{h.summary}</td>
                    <td>{h.requestedBy}</td>
                    <td>{h.status}{h.decidedBy ? ` by ${h.decidedBy}` : ""}</td>
                    <td>{h.comment ?? ""}</td>
                    <td><Link className="underline" href={`/changes/${h.id}`}>#{h.id}</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}
    </div>
  );
}
