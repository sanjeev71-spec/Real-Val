import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { computedBookings } from "@/lib/data";
import { BookingView } from "@/components/BookingView";

export const dynamic = "force-dynamic";

export default async function BookingPage({ params }: { params: Promise<{ bkgId: string }> }) {
  const user = await requireUser();
  const { bkgId } = await params;
  const row = (await computedBookings()).find((r) => String(r.BkgID).toUpperCase() === decodeURIComponent(bkgId).toUpperCase());
  if (!row || (user.role === "sales" && row.Emp !== user.empCode)) notFound();
  return (
    <div className="space-y-4">
      <h1 className="h1">Booking {String(row.BkgID)} — {String(row.Client ?? "")}</h1>
      <BookingView row={row} />
    </div>
  );
}
