import { requireUser } from "@/lib/auth";
import { demandRows } from "@/lib/data";
import { DemandReport } from "@/components/DemandReport";

export const dynamic = "force-dynamic";

export default async function DemandPage() {
  const user = await requireUser(["master", "admin", "sales"]);
  const rows = await demandRows(user.role === "sales" ? user.empCode : null);
  return (
    <div className="space-y-4">
      <div>
        <h1 className="h1">Demand</h1>
        <p className="text-sm text-[var(--muted)]">
          Live and Not Live bookings, sorted by Director, Builder, Project and Client, with Director subtotals. <b>Due</b> = 1st net demand still pending;
          <b> Cleared</b> = 1st demand covered by cheques received. 1st demand falls 45 days after booking; 2nd and 3rd dates come from the project&apos;s price list.
        </p>
      </div>
      <DemandReport rows={rows} />
    </div>
  );
}
