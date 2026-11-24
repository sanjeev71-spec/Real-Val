import { currentUser } from "@/lib/auth";
import { computedBookings, employeesWithCalc, expWithCalc } from "@/lib/data";
import { expExceptionRemarks, storedExpFields } from "@/lib/expRemarks";
import { XLSX_TYPE, combinedWorkbook, stampDate } from "@/lib/excelExport";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Bkg, Exp and Emp in one .xlsx (sheets Bkg, Exp, Emp, same heading colours as the single downloads). Master only (Emp holds personal data). */
export async function GET(req: Request) {
  const user = await currentUser();
  if (!user || user.role !== "master") return new Response("Not allowed", { status: 403 });
  // optional start dates keep the file small: Bkg by BkgMonth, Exp by PayDate (blank = everything)
  const sp = new URL(req.url).searchParams;
  const from = (k: string) => (/^\d{4}-\d{2}-\d{2}$/.test(sp.get(k) ?? "") ? sp.get(k)! : "");
  const bkgFrom = from("bf"), expFrom = from("ef");
  const [bkgRows, expAll, emps] = await Promise.all([computedBookings(), expWithCalc(), employeesWithCalc()]);
  const [remarks, stored] = await Promise.all([expExceptionRemarks(expAll), storedExpFields()]);
  const bkg = bkgFrom ? bkgRows.filter((r) => String(r.BkgMonth ?? "") >= bkgFrom) : bkgRows;
  const exp = expFrom ? expAll.filter((r) => String(r.PayDate ?? "") >= expFrom) : expAll;
  const file = await combinedWorkbook({ bkg, exp, emp: emps, remarks, stored });
  // sent in pieces: a streamed response is not held to the 4.5 MB body limit of a plain function response
  const CHUNK = 64 * 1024;
  let at = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(c) {
      if (at >= file.length) return c.close();
      c.enqueue(file.subarray(at, at + CHUNK));
      at += CHUNK;
    },
  });
  return new Response(body, {
    headers: { "Content-Type": XLSX_TYPE, "Content-Disposition": `attachment; filename="Bkg-Exp-Emp-${stampDate()}.xlsx"` },
  });
}
