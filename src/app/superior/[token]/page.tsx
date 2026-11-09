import { superiorLookup } from "@/lib/workflow";
import { previewBooking } from "@/lib/data";
import { BookingView } from "@/components/BookingView";
import { SuperiorDecision } from "@/components/SuperiorDecision";

export const dynamic = "force-dynamic";

/** Opened from the emailed link — no account needed; the single-use link itself is the credential. */
export default async function SuperiorPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const sub = await superiorLookup(token);
  if (!sub || sub.superiorDecision) {
    return <div className="card mx-auto mt-16 max-w-md text-center">This approval link has expired or has already been used.</div>;
  }
  const row = await previewBooking(sub.data);
  return (
    <div className="space-y-4">
      <h1 className="h1">Approval requested — SCD #{sub.id}</h1>
      <SuperiorDecision token={token} />
      <BookingView row={row} />
    </div>
  );
}
