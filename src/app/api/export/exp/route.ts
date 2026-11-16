import { currentUser } from "@/lib/auth";
import { expWithCalc } from "@/lib/data";
import { EXP_FILTER_KEYS, filterExp } from "@/lib/expFilter";
import { XLSX_TYPE, expWorkbook, stampDate } from "@/lib/excelExport";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Exp table with every calculated column, as .xlsx (oldest first, like the Excel sheet). Honours the same search fields as the Exp page. */
export async function GET(req: Request) {
  const user = await currentUser();
  if (!user || (user.role !== "admin" && user.role !== "master")) return new Response("Not allowed", { status: 403 });
  const sp = new URL(req.url).searchParams;
  const q = Object.fromEntries(EXP_FILTER_KEYS.map((k) => [k, sp.get(k) ?? undefined]));
  const rows = filterExp(await expWithCalc(), q);
  return new Response(await expWorkbook(rows), {
    headers: { "Content-Type": XLSX_TYPE, "Content-Disposition": `attachment; filename="Exp-${stampDate()}.xlsx"` },
  });
}
