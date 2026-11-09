import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth";
import { getDb, schema as s } from "@/lib/db";
import { previewBooking } from "@/lib/data";
import { eventsFor, lastSuperiorEmail, NUDGE_HOURS } from "@/lib/workflow";
import { ACTION_LABEL } from "@/lib/format";
import { StatusPill } from "@/components/StatusPill";
import { BookingView } from "@/components/BookingView";
import { ActionPanel } from "@/components/ActionPanel";

export const dynamic = "force-dynamic";

export default async function SubmissionPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser(["master", "admin", "sales"]);
  const id = Number((await params).id);
  const db = await getDb();
  const [sub] = await db.select().from(s.submissions).where(eq(s.submissions.id, id));
  if (!sub || (user.role === "sales" && sub.submittedBy !== user.id)) notFound();
  const [submitter] = await db.select().from(s.users).where(eq(s.users.id, sub.submittedBy));
  const [row, events, superior] = await Promise.all([previewBooking(sub.data), eventsFor(id), lastSuperiorEmail()]);

  const isPending = sub.status === "pending_admin" || sub.status === "pending_master";
  const canDecide = (user.role === "admin" && sub.status === "pending_admin") || (user.role === "master" && isPending);
  const canEdit = canDecide || (sub.status === "returned" && sub.submittedBy === user.id);
  const nudgeWait = sub.lastNudgeAt ? Math.max(0, NUDGE_HOURS * 3600_000 - (Date.now() - sub.lastNudgeAt.getTime())) : 0;
  const canNudge = isPending && (sub.submittedBy === user.id || user.role !== "sales");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="h1">SCD #{sub.id}</h1>
        <StatusPill status={sub.status} />
        {sub.bkgId && <Link className="btn" href={`/bookings/${sub.bkgId}`}>Booking {sub.bkgId}</Link>}
        {canEdit && <Link className="btn ml-auto" href={`/submissions/${sub.id}/edit`}>{sub.status === "returned" ? "Edit & resubmit" : "Edit fields"}</Link>}
      </div>
      <p className="text-sm text-[var(--muted)]">Submitted by {submitter?.name} on {sub.createdAt.toLocaleString("en-IN")}.
        {sub.superiorEmail && <> Superior ({sub.superiorEmail}): <b>{sub.superiorDecision ?? "awaiting reply"}</b>.</>}
      </p>

      <ActionPanel
        id={sub.id}
        role={user.role}
        canDecide={canDecide}
        canNudge={canNudge}
        nudgeWaitMs={nudgeWait}
        canAskSuperior={user.role === "master" && isPending}
        defaultSuperior={superior ?? ""}
        approveLabel={user.role === "master" ? "Validate & add to Bkg" : "Approve & send to Master"}
      />

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <BookingView row={row} note="Preview: receipts and revenue share are calculated as they would be once this is in Bkg." />
        <section className="card h-fit">
          <h2 className="h2">History</h2>
          <ol className="space-y-3 text-sm">
            {events.map((e) => (
              <li key={e.id}>
                <div className="font-medium">{ACTION_LABEL[e.action] ?? e.action}</div>
                <div className="text-xs text-[var(--muted)]">{e.actorLabel} · {e.createdAt.toLocaleString("en-IN")}</div>
                {e.comment && <div className="mt-1 rounded bg-slate-50 p-2 text-xs">{e.comment}</div>}
              </li>
            ))}
          </ol>
        </section>
      </div>
    </div>
  );
}
