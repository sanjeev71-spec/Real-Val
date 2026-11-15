import ExcelJS from "exceljs";
import { currentUser } from "@/lib/auth";
import { loadPnlData, pnlDirectors, todayIso } from "@/lib/data";
import { computeDirectorSummary, computeTlSummary, computeYearSummary } from "@/lib/calc/pnl";
import { isoToSerial } from "@/lib/calc/excel";

export const dynamic = "force-dynamic";

/** The P&L view on screen, as .xlsx (same numbers, whole rupees). */
export async function GET(req: Request) {
  const user = await currentUser();
  if (!user || user.role !== "master") return new Response("Not allowed", { status: 403 });
  const u = new URL(req.url);
  const view = u.searchParams.get("view") ?? "tl";
  const iso = (k: string, d: string) => (/^\d{4}-\d{2}-\d{2}$/.test(u.searchParams.get(k) ?? "") ? u.searchParams.get(k)! : d);
  const today = todayIso();
  const fromIso = iso("from", `${Number(today.slice(0, 4)) - 3}-01-01`), toIso = iso("to", today);
  const from = isoToSerial(fromIso)!, to = isoToSerial(toIso)!;
  const [data, directors] = await Promise.all([loadPnlData(), pnlDirectors()]);
  const director = directors.includes(u.searchParams.get("director") ?? "") ? u.searchParams.get("director")! : directors[0] ?? "";

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("P&L");
  const put = (cells: (string | number)[], bold = false) => {
    const r = ws.addRow(cells.map((c) => (typeof c === "number" ? Math.round(c) : c)));
    if (bold) r.font = { bold: true };
    r.eachCell((c, i) => { if (i > 1 && typeof c.value === "number") c.numFmt = "#,##0;(#,##0);-"; });
  };

  if (view === "director") {
    ws.addRow([`Director-wise summary ${fromIso} to ${toIso}`]).font = { bold: true };
    put(["Director", "F&F (ShareAmt - Paid Exp)", "P&L (RA - Paid Exp)", "DirectorRevenue + Incentives", "ShareAmt", "ShareAmt x RA%", "Paid Exp"], true);
    for (const r of computeDirectorSummary(data, directors, from, to).filter((x) => x.revInc || x.share || x.exp)) put([r.director, r.ff, r.pl, r.revInc, r.share, r.shareRA, r.exp]);
  } else if (view === "year") {
    const s = computeYearSummary(data, director, from, to);
    ws.addRow([`Calendar-year summary - ${director} (${fromIso} to ${toIso})`]).font = { bold: true };
    put(["", "Total", ...s.years], true);
    put(["F&F (ShareAmt - Paid Exp)", s.total.ff, ...s.ff], true);
    put(["P&L (RA - Paid Exp)", s.total.pl, ...s.pl], true);
    put(["DirectorRevenue + Incentives", s.total.revInc, ...s.revInc]);
    put(["ShareAmt", s.total.share, ...s.share]);
    put(["ShareAmt x RA%", s.total.shareRA, ...s.shareRA]);
    put(["Expense summary", s.total.expTotal, ...s.expTotal], true);
    for (const h of s.heads) put([h, s.total.exp[h], ...s.exp[h]]);
  } else {
    const s = computeTlSummary(data, director, from, to);
    ws.addRow([`TL-wise summary - ${director} (${fromIso} to ${toIso})`]).font = { bold: true };
    put(["", "Total", ...s.cols.map((c) => c.name)], true);
    put(["F&F (ShareAmt - Paid Exp)", s.total.ff, ...s.ff], true);
    put(["P&L (RA - Paid Exp)", s.total.pl, ...s.pl], true);
    put(["DirectorRevenue + Incentives", s.total.revInc, ...s.revInc]);
    put(["ShareAmt", s.total.share, ...s.share]);
    put(["ShareAmt x RA%", s.total.shareRA, ...s.shareRA]);
    put(["Expense summary - TL wise", s.total.expTotal, ...s.expTotal], true);
    for (const h of s.heads) put([h, s.total.exp[h], ...s.exp[h]]);
  }
  ws.getColumn(1).width = 34;
  for (let c = 2; c <= 30; c++) ws.getColumn(c).width = 18;
  return new Response(await wb.xlsx.writeBuffer(), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="PnL-${view}-${today}.xlsx"`,
    },
  });
}
