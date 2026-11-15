import ExcelJS from "exceljs";
import { currentUser } from "@/lib/auth";
import { expWithCalc } from "@/lib/data";
import { EXP_COLUMNS } from "@/lib/calc/exp";
import { EXP_FILTER_KEYS, filterExp } from "@/lib/expFilter";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Exp table with every calculated column, as .xlsx (oldest first, like the Excel sheet). Honours the same search fields as the Exp page. */
export async function GET(req: Request) {
  const user = await currentUser();
  if (!user || (user.role !== "admin" && user.role !== "master")) return new Response("Not allowed", { status: 403 });
  const sp = new URL(req.url).searchParams;
  const q = Object.fromEntries(EXP_FILTER_KEYS.map((k) => [k, sp.get(k) ?? undefined]));
  const rows = filterExp(await expWithCalc(), q);
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Exp");
  const dates = new Set(["PayDate", "ValueDate", "Chq/UTR Date"]);
  ws.columns = EXP_COLUMNS.map((c) => ({ header: c, key: c, width: Math.max(10, c.length + 2), style: dates.has(c) ? { numFmt: "dd-mm-yyyy" } : {} }));
  for (const r of [...rows].reverse())
    ws.addRow(Object.fromEntries(EXP_COLUMNS.map((c) => [c, dates.has(c) && typeof r[c] === "string" ? new Date(`${r[c]}T00:00:00Z`) : r[c] ?? null])));
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: "frozen", ySplit: 1 }];
  return new Response(await wb.xlsx.writeBuffer(), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="Exp-${new Date().toISOString().slice(0, 10)}.xlsx"`,
    },
  });
}
