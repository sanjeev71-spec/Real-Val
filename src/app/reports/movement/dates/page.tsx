import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { eventGroups, syncBookingEventsQuietly } from "@/lib/bookingEvents";
import { EventTable } from "@/components/EventTable";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Old cancellations / RA closes whose date was guessed when the event log started: Master / Admin confirm or correct each one. */
export default async function ConfirmDates() {
  await requireUser(["master", "admin"]);
  await syncBookingEventsQuietly();
  const groups = await eventGroups({ unconfirmed: true });
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="h1">Event dates to confirm</h1>
        <Link className="btn ml-auto" href="/reports/movement">Monthly movement</Link>
      </div>
      <p className="text-sm text-[var(--muted)]">
        These cancellations and RA closes happened before the event log started, and the change log had no date for them, so the booking date was used.
        Type the date it really happened (the month it should count in) and press Confirm; if the date shown is right, just press Confirm.
      </p>
      <div className="card overflow-x-auto">
        {groups.length ? <EventTable groups={groups} canEdit showBooking /> : <p className="text-sm text-green-700">✓ Every date is confirmed.</p>}
      </div>
    </div>
  );
}
