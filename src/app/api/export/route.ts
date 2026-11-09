import ExcelJS from "exceljs";
import { currentUser } from "@/lib/auth";
import { computedBookings } from "@/lib/data";
import { BKG_COLUMNS, DATE_KEYS } from "@/lib/fields";

export const dynamic = "force-dynamic";

/** Downloads the Bkg table (every column, calculated values) as .xlsx. */
export async function GET(req: Request) {
  const user = await currentUser();
  if (!user) return new Response("Sign in first", { status: 401 });
  const q = (new URL(req.url).searchParams.get("q") ?? "").trim().toLowerCase();
  let rows = await computedBookings();
  if (user.role === "sales") rows = rows.filter((r) => r.Emp === user.empCode);
  if (q) rows = rows.filter((r) => ["BkgID", "Client", "ContactNo", "UnitNo", "Project", "Emp"].some((k) => String(r[k] ?? "").toLowerCase().includes(q)));

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Bkg");
  ws.columns = BKG_COLUMNS.map((c) => ({ header: c, key: c, width: Math.max(10, c.length + 2), style: DATE_KEYS.has(c) ? { numFmt: "dd-mm-yyyy" } : {} }));
  for (const r of rows) {
    ws.addRow(Object.fromEntries(BKG_COLUMNS.map((c) => {
      const v = r[c];
      if (DATE_KEYS.has(c) && typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)) return [c, new Date(`${v}T00:00:00Z`)];
      return [c, v ?? null];
    })));
  }
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: "frozen", ySplit: 1 }];
  const buf = await wb.xlsx.writeBuffer();
  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(buf, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="Bkg-${stamp}.xlsx"`,
    },
  });
}
