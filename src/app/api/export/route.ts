import ExcelJS from "exceljs";
import { currentUser } from "@/lib/auth";
import { computedBookings } from "@/lib/data";
import { BKG_COLUMNS, DATE_KEYS } from "@/lib/fields";

export const dynamic = "force-dynamic";

/** Downloads the Bkg table (every column, calculated values) as .xlsx. */
export async function GET(req: Request) {
  const user = await currentUser();
  if (!user) return new Response("Sign in first", { status: 401 });
  // Same partial-text filters as the Bkg page: Director, Builder, Project, Client, BkgID, UnitNo
  const params = new URL(req.url).searchParams;
  const terms = ["Director", "Builder", "Project", "Client", "BkgID", "UnitNo"]
    .map((k) => [k, (params.get(k) ?? "").trim().toLowerCase()] as const)
    .filter(([, v]) => v);
  let rows = await computedBookings();
  if (user.role === "sales") rows = rows.filter((r) => r.Emp === user.empCode);
  const text = (r: Record<string, unknown>, k: string) => (k === "Director" ? String(r[k] ?? "").split("~")[0] : String(r[k] ?? "")).toLowerCase();
  if (terms.length) rows = rows.filter((r) => terms.every(([k, v]) => text(r, k).includes(v)));

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
