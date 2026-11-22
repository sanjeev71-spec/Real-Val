import { notFound } from "next/navigation";
import { sql } from "drizzle-orm";
import { requireUser } from "@/lib/auth";
import { getDb, schema as s } from "@/lib/db";
import { loadMasters } from "@/lib/data";
import { normalize } from "@/lib/validate";
import { ScdForm } from "@/components/ScdForm";

export const dynamic = "force-dynamic";

export default async function EditBooking({ params }: { params: Promise<{ bkgId: string }> }) {
  const user = await requireUser(["master", "admin"]);
  const bkgId = decodeURIComponent((await params).bkgId);
  const db = await getDb();
  const [b] = await db.select().from(s.bookings).where(sql`upper(${s.bookings.bkgId}) = ${bkgId.toUpperCase()}`);
  if (!b) notFound();
  const masters = await loadMasters();
  const initial = { ...normalize(b.data as Record<string, unknown>), BkgID: b.bkgId };
  return (
    <div className="space-y-4">
      <h1 className="h1">Edit booking {b.bkgId}</h1>
      <ScdForm masters={masters} initial={initial} role={user.role} mode={{ kind: "bkg", bkgId: b.bkgId }} />
    </div>
  );
}
