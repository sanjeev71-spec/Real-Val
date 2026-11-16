import { currentUser } from "@/lib/auth";
import { computedBookings } from "@/lib/data";
import { filterBkg } from "@/lib/bkgFilter";
import { XLSX_TYPE, bkgWorkbook, stampDate } from "@/lib/excelExport";

export const dynamic = "force-dynamic";

/** Downloads the Bkg table (every column, calculated values) as .xlsx. */
export async function GET(req: Request) {
  const user = await currentUser();
  if (!user) return new Response("Sign in first", { status: 401 });
  // Same filters as the Bkg page
  const params = new URL(req.url).searchParams;
  let rows = await computedBookings();
  if (user.role === "sales") rows = rows.filter((r) => r.Emp === user.empCode);
  rows = filterBkg(rows, (k) => params.get(k));
  return new Response(await bkgWorkbook(rows), {
    headers: { "Content-Type": XLSX_TYPE, "Content-Disposition": `attachment; filename="Bkg-${stampDate()}.xlsx"` },
  });
}
