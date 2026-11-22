import { currentUser } from "@/lib/auth";
import { expWithCalc } from "@/lib/data";
import { EXP_FILTER_KEYS, filterExp } from "@/lib/expFilter";
import { expExceptionRemarks, storedExpFields } from "@/lib/expRemarks";
import { XLSX_TYPE, expWorkbook, stampDate } from "@/lib/excelExport";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Exp table with every calculated column, as .xlsx (oldest first, like the Excel sheet). Honours the same search fields as the Exp page.
 * Data Exception Remarks and Group are the first columns; ?exc=1 keeps only the entries that have a data exception.
 */
export async function GET(req: Request) {
  const user = await currentUser();
  if (!user || (user.role !== "admin" && user.role !== "master")) return new Response("Not allowed", { status: 403 });
  const sp = new URL(req.url).searchParams;
  const q = Object.fromEntries(EXP_FILTER_KEYS.map((k) => [k, sp.get(k) ?? undefined]));
  const all = await expWithCalc();
  const [remarks, stored] = await Promise.all([expExceptionRemarks(all), storedExpFields()]);
  let rows = filterExp(all, q);
  if (sp.get("exc") === "1") rows = rows.filter((r) => remarks.has(Number(r.id)));
  return new Response(await expWorkbook(rows, remarks, stored), {
    headers: { "Content-Type": XLSX_TYPE, "Content-Disposition": `attachment; filename="Exp-${sp.get("exc") === "1" ? "to-complete-" : ""}${stampDate()}.xlsx"` },
  });
}
