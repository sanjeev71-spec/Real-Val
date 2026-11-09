import { requireUser } from "@/lib/auth";
import { expFormData } from "@/lib/data";
import { ExpForm } from "@/components/ExpForm";

export const dynamic = "force-dynamic";

export default async function NewExp() {
  const user = await requireUser(["admin", "master"]);
  const f = await expFormData();
  return (
    <div className="space-y-4">
      <div>
        <h1 className="h1">New Exp entry (receipt / payment)</h1>
        <p className="text-sm text-[var(--muted)]">
          {user.role === "master" ? "Saved straight into Exp." : "Goes to the Master for approval; the DocNo is assigned when it is approved."}
        </p>
      </div>
      <ExpForm role={user.role} {...f} />
    </div>
  );
}
