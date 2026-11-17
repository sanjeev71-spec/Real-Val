import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { computedBookings } from "@/lib/data";
import Link from "next/link";
import { bkgHistory } from "@/lib/bkgHistory";
import { BookingView } from "@/components/BookingView";

export const dynamic = "force-dynamic";

export default async function BookingPage({ params }: { params: Promise<{ bkgId: string }> }) {
  const user = await requireUser(["master", "admin", "sales"]);
  const { bkgId } = await params;
  const row = (await computedBookings()).find((r) => String(r.BkgID).toUpperCase() === decodeURIComponent(bkgId).toUpperCase());
  if (!row || (user.role === "sales" && row.Emp !== user.empCode)) notFound();
  const history = user.role === "sales" ? null : await bkgHistory(String(row.BkgID));
  return (
    <div className="space-y-4">
      <h1 className="h1 overflow-x-auto whitespace-nowrap !text-base font-bold leading-snug sm:!text-[17px]">
        {[row.BkgID, row.Client, row.Builder, row.Project, row.UnitNo].map((x) => String(x ?? "").trim()).filter(Boolean).join(" ~ ")}
      </h1>
      <BookingView row={row} />
      {history && (
        <section className="card overflow-x-auto">
          <h2 className="h2">History of this booking</h2>
          {history.length === 0 ? <p className="text-sm text-[var(--muted)]">No upload has changed this booking.</p> : (
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
