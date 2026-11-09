import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth";
import { getDb, schema as s } from "@/lib/db";
import { loadMasters } from "@/lib/data";
import { ScdForm } from "@/components/ScdForm";

export const dynamic = "force-dynamic";

export default async function EditSubmission({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser(["master", "admin", "sales"]);
  const id = Number((await params).id);
  const db = await getDb();
  const [sub] = await db.select().from(s.submissions).where(eq(s.submissions.id, id));
  if (!sub) notFound();
  const resubmit = sub.status === "returned" && sub.submittedBy === user.id;
  const reviewer = (user.role === "admin" && sub.status === "pending_admin") || (user.role === "master" && ["pending_admin", "pending_master"].includes(sub.status));
  if (!resubmit && !reviewer) notFound();
  const masters = await loadMasters(id);
  return (
    <div className="space-y-4">
      <h1 className="h1">{resubmit ? `Edit & resubmit SCD #${id}` : `Edit SCD #${id}`}</h1>
      <ScdForm masters={masters} initial={sub.data} role={user.role} mode={{ kind: "edit", id, resubmit }} />
    </div>
  );
}
