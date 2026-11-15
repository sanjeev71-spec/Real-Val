import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { expFormData } from "@/lib/data";
import { draftById, draftsOf } from "@/lib/expExtras";
import { ExpDocForm, type DocLine } from "@/components/ExpDocForm";
import { DraftList } from "@/components/DraftList";

export const dynamic = "force-dynamic";

export default async function NewExp({ searchParams }: { searchParams: Promise<{ draft?: string }> }) {
  const user = await requireUser(["admin", "master"]);
  const q = await searchParams;
  const draftId = Number(q.draft) || null;
  const [f, drafts, draft] = await Promise.all([expFormData(), draftsOf(user.id), draftId ? draftById(draftId, user.id) : null]);
  const d = draft?.data as { header?: Record<string, string | number | null>; lines?: DocLine[] } | undefined;
  return (
    <div className="space-y-4">
      <div>
        <h1 className="h1">New Exp document (one transaction, one or more lines)</h1>
        <p className="text-sm text-[var(--muted)]">
          {user.role === "master" ? "Saved straight into Exp." : "Goes to the Master for approval; the document number is assigned when it is approved."}
          {" "}Use <b>Paste from Excel</b> to bring in many lines at once, or <b>Save draft</b> to finish later.
        </p>
      </div>
      <DraftList drafts={drafts.map((x) => ({ id: x.id, title: x.title, updatedAt: x.updatedAt?.toISOString() ?? "" }))} current={draft ? draft.id : null} />
      <ExpDocForm key={draft?.id ?? "new"} role={user.role} {...f} draftId={draft?.id ?? null}
        initial={d?.header && d.lines?.length ? { header: d.header, lines: d.lines } : undefined} />
      {draftId && !draft && <p className="text-sm text-red-700">That draft was not found (it may have been used already). <Link className="link" href="/exp/new">Start a new document</Link></p>}
    </div>
  );
}
