import { requireUser } from "@/lib/auth";
import { expFormData } from "@/lib/data";
import { ExpDocForm } from "@/components/ExpDocForm";

export const dynamic = "force-dynamic";

export default async function NewExp() {
  const user = await requireUser(["admin", "master"]);
  const f = await expFormData();
  return (
    <div className="space-y-4">
      <div>
        <h1 className="h1">New Exp document (one transaction, one or more lines)</h1>
        <p className="text-sm text-[var(--muted)]">
          {user.role === "master" ? "Saved straight into Exp." : "Goes to the Master for approval; the document number is assigned when it is approved."}
        </p>
      </div>
      <ExpDocForm role={user.role} {...f} />
    </div>
  );
}
