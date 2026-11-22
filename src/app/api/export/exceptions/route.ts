import { currentUser } from "@/lib/auth";
import { getDb, schema as s } from "@/lib/db";
import { loadCore } from "@/lib/data";
import { exceptionRemarks, findExceptions } from "@/lib/calc/exceptions";
import { storedExpFields } from "@/lib/expRemarks";
import { XLSX_TYPE, bkgWorkbook, expWorkbook, stampDate } from "@/lib/excelExport";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** One Data exceptions check as .xlsx, in the same format as the Bkg or Exp download. ?key=exp-no-head */
export async function GET(req: Request) {
  const user = await currentUser();
  if (!user || (user.role !== "admin" && user.role !== "master")) return new Response("Not allowed", { status: 403 });
  const key = new URL(req.url).searchParams.get("key") ?? "";
  const db = await getDb();
  const [{ bk, exps }, emps, heads] = await Promise.all([
    loadCore(),
    db.selectDistinct({ emp: s.employees.emp }).from(s.employees),
    db.select({ head: s.expHeads.head }).from(s.expHeads),
  ]);
  const groups = findExceptions(bk as never, exps as never, new Set(emps.map((e) => e.emp)), new Set(heads.map((h) => h.head.toLowerCase())));
  const g = groups.find((x) => x.key === key);
  if (!g) return new Response("No such check (or nothing to download any more)", { status: 404 });
  const body = g.kind === "bkg" ? await bkgWorkbook(g.rows) : await expWorkbook(g.rows, exceptionRemarks(groups), await storedExpFields());
  return new Response(body, {
    headers: { "Content-Type": XLSX_TYPE, "Content-Disposition": `attachment; filename="${g.kind === "bkg" ? "Bkg" : "Exp"}-exceptions-${key}-${stampDate()}.xlsx"` },
  });
}
