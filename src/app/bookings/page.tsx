import { requireUser } from "@/lib/auth";
import { computedBookings } from "@/lib/data";
import { BkgTable, type BkgListRow } from "@/components/BkgTable";

export const dynamic = "force-dynamic";

const num = (v: unknown) => (typeof v === "number" ? v : null);
const nameOnly = (v: unknown) => String(v ?? "").split("~")[0];

export default async function Bookings() {
  const user = await requireUser(["master", "admin", "sales"]);
  const all = await computedBookings();
  const mine = user.role === "sales" ? all.filter((r) => r.Emp === user.empCode) : all;
  const rows: BkgListRow[] = mine.map((r) => ({
    BkgID: String(r.BkgID ?? ""),
    BkgLoginDate: (r.BkgLoginDate as string) ?? null,
    FormStatus: String(r.FormStatus ?? ""),
    Director: nameOnly(r.Director),
    Builder: String(r.Builder ?? ""),
    Project: String(r.Project ?? ""),
    Client: String(r.Client ?? ""),
    UnitNo: String(r.UnitNo ?? ""),
    Emp: String(r.Emp ?? ""),
    TCWithGST: num(r.TCWithGST),
    TotalRecdAmt: num(r.TotalRecdAmt),
    CoRev: num(r.CoRev),
  }));
  return (
    <div className="space-y-4">
      <h1 className="h1">Bkg</h1>
      <BkgTable rows={rows} />
    </div>
  );
}
