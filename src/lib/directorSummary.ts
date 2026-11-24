// One summary file for all Directors (Directors in rows, inactive ones in red). Uses the same numbers as each Director's own pack.
import ExcelJS from "exceljs";
import { computeTlSummary, type PnlData } from "./calc/pnl";
import { isoToSerial, codeOf } from "./calc/excel";
import { bookingDetail } from "./directorPack";
import type { BookingRow } from "./calc/booking";

export interface SummaryDirector { name: string; active: boolean }
export interface SummaryInput {
  directors: SummaryDirector[];
  bkgFrom: string; bkgTo: string; expFrom: string; expTo: string; // yyyy-mm-dd
  bkgFromFor: Record<string, string>; // Director code (lower case) -> own booking-from date
  pnl: PnlData;
  bookings: BookingRow[];
}

const NUM = '#,##0;(#,##0);"-"';
const dmy = (iso: string) => `${iso.slice(8, 10)}-${iso.slice(5, 7)}-${iso.slice(0, 4)}`;
const HEAD = ["Director", "Booking from", "F&F (ShareAmt - Paid Exp)", "P&L (RA - Paid Exp)", "DirectorRevenue + Incentives", "ShareAmt", "ShareAmt x RA%", "Expense", "Seat Cost"];

export async function buildDirectorSummary(inp: SummaryInput): Promise<Buffer> {
  const bt = isoToSerial(inp.bkgTo)!, ef = isoToSerial(inp.expFrom)!, et = isoToSerial(inp.expTo)!;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Director Summary");
  const own = Object.entries(inp.bkgFromFor).filter(([, d]) => d !== inp.bkgFrom);
  ws.getCell(1, 1).value = "P&L Summary - all Directors";
  ws.getCell(1, 1).font = { bold: true, size: 14 };
  ws.getCell(2, 1).value = `Booking Period ${dmy(inp.bkgFrom)} to ${dmy(inp.bkgTo)}${own.length ? " (a different start for the Directors whose Booking from is shown)" : ""}`;
  ws.getCell(3, 1).value = `Exp Period ${dmy(inp.expFrom)} to ${dmy(inp.expTo)}. Bookings counted: Live and Not Live only; ShareAmt and ShareAmt x RA% include the Override share. Expense includes Seat Cost.`;
  const hr = ws.getRow(5);
  HEAD.forEach((h, i) => {
    const c = hr.getCell(i + 1);
    c.value = h;
    c.font = { bold: true, color: { argb: "FFFFFFFF" } };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F4E79" } };
    c.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  });
  for (const d of inp.directors) {
    const from = inp.bkgFromFor[codeOf(d.name).toLowerCase()] ?? inp.bkgFrom;
    const bf = isoToSerial(from)!;
    const live = bookingDetail(inp.bookings, d.name, bf, bt).filter((x) => x.sold);
    const share = live.reduce((s, x) => s + x.share + x.ovShare, 0);
    const shareRA = live.reduce((s, x) => s + x.shareRA + x.ovRA, 0);
    const rev = live.reduce((s, x) => s + x.rev, 0);
    const se = computeTlSummary(inp.pnl, d.name, ef, et);
    const expense = se.total.expTotal, seat = se.total.exp["Seat Cost"] ?? 0;
    const vals = [share - expense, shareRA - expense, rev, share, shareRA, expense, seat].map(Math.round);
    const r = ws.addRow([d.name, new Date(`${from}T00:00:00Z`), ...vals]);
    r.getCell(2).numFmt = "dd-mm-yyyy";
    r.getCell(2).alignment = { horizontal: "center" };
    for (let i = 3; i <= 9; i++) r.getCell(i).numFmt = NUM;
    if (!d.active) r.getCell(1).font = { color: { argb: "FFC00000" }, bold: true };
    if (from !== inp.bkgFrom) r.getCell(2).font = { bold: true };
  }
  ws.getColumn(1).width = 30; ws.getColumn(2).width = 14;
  for (let c = 3; c <= 9; c++) ws.getColumn(c).width = 18;
  ws.getRow(5).height = 32;
  ws.views = [{ state: "frozen", xSplit: 1, ySplit: 5 }];
  ws.getCell(inp.directors.length + 8, 1).value = "Directors shown in red are inactive. No grand total: a Director’s chain can include other Directors, so rows overlap.";
  ws.getCell(inp.directors.length + 8, 1).font = { color: { argb: "FFC00000" }, italic: true };
  return Buffer.from(await wb.xlsx.writeBuffer());
}
