import { requireUser } from "@/lib/auth";
import { loadMasters } from "@/lib/data";
import { NEW_BOOKING_DEFAULTS } from "@/lib/fields";
import { ScdForm } from "@/components/ScdForm";

export const dynamic = "force-dynamic";

export default async function NewScd() {
  const user = await requireUser(["master", "admin", "sales"]);
  const masters = await loadMasters();
  const today = new Date().toISOString().slice(0, 10);
  const initial = { ...NEW_BOOKING_DEFAULTS, BkgLoginDate: today, Emp: user.empCode ?? null };
  return (
    <div className="space-y-4">
      <div>
        <h1 className="h1">Sale Confirmation Dossier (SCD)</h1>
        <p className="text-sm text-[var(--muted)]">
          {user.role === "sales" && "After you submit, an Admin approves it and then the Master validates it before it is added to Bkg."}
          {user.role === "admin" && "After you submit, the Master validates it before it is added to Bkg."}
          {user.role === "master" && "As Master, saving adds the booking to Bkg straight away."}
        </p>
      </div>
      <ScdForm masters={masters} initial={initial} role={user.role} mode={{ kind: "new" }} />
    </div>
  );
}
