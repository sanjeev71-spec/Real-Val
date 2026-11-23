// Individual P&L pack for one Director: 4 sheets (P&L summary TL-wise, Bkg Data, Exp Data, Employee Data) as an .xlsx.
import ExcelJS from "exceljs";
import { computeTlSummary, type PnlData } from "./calc/pnl";
import { colName } from "./fields";
import { codeOf, isoToSerial, num } from "./calc/excel";
import type { BookingRow } from "./calc/booking";
import type { employeesWithCalc } from "./data";

type ExpRowAny = Record<string, unknown>;
type EmpRows = Awaited<ReturnType<typeof employeesWithCalc>>;

export interface PackInput {
  director: string; // Name~Code
  bkgFrom: string; bkgTo: string; expFrom: string; expTo: string; // yyyy-mm-dd
  pnl: PnlData;
  bookings: BookingRow[];
  exps: ExpRowAny[];
  emps: EmpRows;
}

const NUM = '#,##0;(#,##0);"-"';
const HDR = "FF1F4E79";
const SOLD = new Set(["live", "not live"]);
const sameCode = (a: unknown, code: string) => code !== "" && codeOf(String(a ?? "")).toLowerCase() === code.toLowerCase();
const dmy = (iso: string) => `${iso.slice(8, 10)}-${iso.slice(5, 7)}-${iso.slice(0, 4)}`;
const asDate = (v: unknown): Date | string => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) ? new Date(`${v.slice(0, 10)}T00:00:00Z`) : (v as string) ?? "");

function header(ws: ExcelJS.Worksheet, row: number, cols: string[]) {
  const r = ws.getRow(row);
  cols.forEach((c, i) => {
    const cell = r.getCell(i + 1);
    cell.value = c;
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HDR } };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  });
}
const title = (ws: ExcelJS.Worksheet, lines: string[]) => lines.forEach((l, i) => { const c = ws.getCell(i + 1, 1); c.value = l; if (i === 0) c.font = { bold: true, size: 14 }; });

export async function buildDirectorPack(inp: PackInput): Promise<Buffer> {
  const dc = codeOf(inp.director);
  const bf = isoToSerial(inp.bkgFrom)!, bt = isoToSerial(inp.bkgTo)!;
  const ef = isoToSerial(inp.expFrom)!, et = isoToSerial(inp.expTo)!;
  const wb = new ExcelJS.Workbook();
  const periods = [`Booking Period ${dmy(inp.bkgFrom)} to ${dmy(inp.bkgTo)}`, `Exp Period ${dmy(inp.expFrom)} to ${dmy(inp.expTo)}`];

  // ---- Bkg detail first: the summary is tied to it
  // Per booking where this Director is in the revenue-share chain (Basis "Chain") or is the override employee (Basis "Override"):
  //   DirectorRevenue + Incentives = DirectorRevenue + DirectorSplRevenue + SpinToWin + IncentiveTRPL
  //   ShareAmt = DirectorRevenue x Director Sharing + DirectorSplRevenue + SpinToWin + IncentiveTRPL ; ShareAmt x RA% = ShareAmt x RA%
  //   Override_Share / Override_Share x RA are added on top.
  const isSold = (b: BookingRow) => SOLD.has(String(b.FormStatus ?? "").trim().toLowerCase());
  const lowest = (b: BookingRow) => { for (let k = 0; k < 5; k++) { const e = String(b[`L${k}_Emp`] ?? ""); if (e) return codeOf(e).toLowerCase(); } return ""; };
  interface Det { b: BookingRow; chain: boolean; override: boolean; sold: boolean; rev: number; sharing: number; share: number; shareRA: number; ovShare: number; ovRA: number; revRA: number }
  const det: Det[] = inp.bookings
    .filter((b) => { const m = isoToSerial(b.BkgMonth as string); return m !== null && m >= bf && m <= bt; })
    .map((b) => {
      const chain = [0, 1, 2, 3, 4].some((k) => sameCode(b[`L${k}_Emp`], dc));
      const override = sameCode(b.Override_Emp, dc);
      const ra = num(b["RA%"]);
      let sharing = 0;
      for (let k = 0; k < 5; k++) if (sameCode(b[`L${k}_Emp`], dc)) sharing += num(b[`L${k}_Share%`]);
      const inc = num(b.DirectorSplRevenue) + num(b.SpinToWin) + num(b.IncentiveRV);
      const rev = chain ? num(b.DirectorRevenue) + inc : 0;
      const share = chain ? Math.round(num(b.DirectorRevenue) * sharing + inc) : 0;
      const ovShare = override ? num(b.Override_Share) : 0;
      return { b, chain, override, sold: isSold(b), rev, sharing, share, shareRA: Math.round(share * ra), ovShare, ovRA: override ? num(b.Override_SharexRA) : 0, revRA: chain ? num(b.DirectorRevenue) * ra : 0 };
    })
    .filter((d) => d.chain || d.override)
    .sort((x, y) => String(x.b.BkgMonth).localeCompare(String(y.b.BkgMonth)));
  const live = det.filter((d) => d.sold);
  const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
  const sumOf = (f: (d: Det) => number) => live.reduce((s, d) => s + f(d), 0);

  // ---- 1. P&L summary (TL-wise)
  // bookings follow the booking period, expenses and seat cost the exp period: compute the two halves separately
  const sb = computeTlSummary(inp.pnl, inp.director, bf, bt);
  const se = computeTlSummary(inp.pnl, inp.director, ef, et);
  const ws1 = wb.addWorksheet("P&L Summary");
  title(ws1, [`P&L Summary TL-wise - ${inp.director}`, ...periods, "Bookings counted: Live and Not Live only. ShareAmt and ShareAmt x RA% include the Override share."]);
  // the TL columns of the two runs can differ (team in a different window): align on code
  const codes = [...new Set([...sb.cols, ...se.cols].map((c) => c.code))];
  const nameOf = new Map([...se.cols, ...sb.cols].map((c) => [c.code, c.name]));
  const at = (s: ReturnType<typeof computeTlSummary>, arr: number[]) => codes.map((c) => { const i = s.cols.findIndex((x) => x.code === c); return i < 0 ? 0 : arr[i]; });
  // revenue per TL: each booking's DirectorRevenue + Incentives sits with the TL at the bottom of its chain
  const revInc = codes.map((c) => live.reduce((s, d) => (d.chain && lowest(d.b) === c.toLowerCase() ? s + d.rev : s), 0));
  const share = at(sb, sb.share), shareRA = at(sb, sb.shareRA);
  // the detail rounds ShareAmt per booking; keep the summary equal to it to the rupee by settling the rounding on the Director's own column
  const own = codes.indexOf(dc.toLowerCase());
  const settle = (arr: number[], target: number) => { const d = Math.round(target) - Math.round(sum(arr)); if (own >= 0 && Math.abs(d) <= 100) arr[own] += d; };
  settle(share, sumOf((d) => d.share + d.ovShare));
  settle(shareRA, sumOf((d) => d.shareRA + d.ovRA));
  const heads = se.heads;
  const exp: Record<string, number[]> = Object.fromEntries(heads.map((h) => [h, at(se, se.exp[h])]));
  const expTotal = codes.map((_, i) => heads.reduce((s, h) => s + exp[h][i], 0));
  const ff = codes.map((_, i) => share[i] - expTotal[i]);
  const pl = codes.map((_, i) => shareRA[i] - expTotal[i]);
  header(ws1, 6, ["", "Total", ...codes.map((c) => (nameOf.get(c) ?? c).split("~")[0])]);
  const put = (label: string, vals: number[], bold = false) => {
    const r = ws1.addRow([label, Math.round(sum(vals)), ...vals.map(Math.round)]);
    if (bold) r.font = { bold: true };
    r.eachCell((c, i) => { if (i > 1) c.numFmt = NUM; });
  };
  put("F&F (ShareAmt - Paid Exp)", ff, true);
  put("P&L (RA - Paid Exp)", pl, true);
  put("DirectorRevenue + Incentives", revInc);
  put("ShareAmt", share);
  put("ShareAmt x RA%", shareRA);
  put("Expense summary - TL wise", expTotal, true);
  for (const h of heads) put(h, exp[h]);
  ws1.getColumn(1).width = 34;
  for (let c = 2; c <= codes.length + 2; c++) ws1.getColumn(c).width = 16;
  ws1.views = [{ state: "frozen", xSplit: 1, ySplit: 6 }];

  // ---- 2. Bkg data
  const ws2 = wb.addWorksheet("Bkg Data");
  title(ws2, [`Bkg Data - ${inp.director}`, periods[0],
    "DirectorRevenue + Incentives = DirectorRevenue + DirectorSplRevenue + SpinToWin + " + colName("IncentiveRV") + ". Director Share (ShareAmt) = DirectorRevenue x Director Sharing + DirectorSplRevenue + SpinToWin + " + colName("IncentiveRV") + ". Director Share RA = Director Share x RA%. Total Share adds the Override share.",
    "Basis: Chain = the Director is in the revenue-share chain; Override = the Director gets an override share only (revenue columns left blank)."]);
  const bh = ["BkgMonth", "Client", "Project", "Form Status", "Area", "NetBSPPSF", "TotalChargesPSF", "TotalCostAmt", "RC/RA", "Recd%", "DSlab", "DirectorRevenue", "DirectorSplRevenue", "SpinToWin", "IncentivePOC", colName("IncentiveRV"), "IncentiveBuilder",
    "DirectorRevenue + Incentives", "Director Revenue RA", "Director Sharing", "Director Share", "Director Share RA", "Override_Share", "Override_Share RA", "Total Share (incl. Override)", "Total Share RA (incl. Override)", "Basis"];
  header(ws2, 6, bh);
  const SUMCOLS = new Set([7, 11, 12, 13, 14, 15, 16, 17, 18, 20, 21, 22, 23, 24, 25]); // 0-based columns that get a total
  const totals = new Array(bh.length).fill(0);
  for (const d of det) {
    const b = d.b;
    const c = d.chain;
    const vals: (string | number | Date | null)[] = [
      asDate(b.BkgMonth), String(b.Client ?? ""), String(b.Project ?? ""), String(b.FormStatus ?? ""), num(b.Area), num(b.NetBSPPSF), num(b.TotalChargesPSF), c ? num(b.TotalCostAmt) : null,
      String(b["RC/RA"] ?? ""), num(b["Recd%"]), num(b.DSlab),
      c ? num(b.DirectorRevenue) : null, c ? num(b.DirectorSplRevenue) : null, c ? num(b.SpinToWin) : null, c ? num(b.IncentivePOC) : null, c ? num(b.IncentiveRV) : null, c ? num(b.IncentiveBuilder) : null,
      c ? d.rev : null, c ? d.revRA : null, c ? d.sharing : null, c ? d.share : null, c ? d.shareRA : null,
      d.ovShare, d.ovRA, d.share + d.ovShare, d.shareRA + d.ovRA, c && d.override ? "Chain + Override" : c ? "Chain" : "Override",
    ];
    if (d.sold) vals.forEach((v, i) => { if (SUMCOLS.has(i) && typeof v === "number") totals[i] += v; });
    const r = ws2.addRow(vals);
    r.getCell(1).numFmt = "mmm-yyyy";
    [5, 6, 7, 8, 11, 12, 13, 14, 15, 16, 17, 18, 19, 21, 22, 23, 24, 25, 26].forEach((n) => (r.getCell(n).numFmt = NUM));
    r.getCell(10).numFmt = "0.0%"; r.getCell(20).numFmt = "0.0%";
  }
  const tr = ws2.addRow(bh.map((_, i) => (i === 0 ? "Total (Live + Not Live only)" : SUMCOLS.has(i) ? Math.round(totals[i]) : "")));
  tr.font = { bold: true };
  tr.eachCell((c, i) => { c.border = { top: { style: "thin" } }; if (i > 1) c.numFmt = NUM; });
  ws2.getColumn(1).width = 11; ws2.getColumn(2).width = 28; ws2.getColumn(3).width = 28;
  for (let c = 4; c <= bh.length; c++) ws2.getColumn(c).width = 14;
  ws2.getColumn(bh.length).width = 18;
  ws2.views = [{ state: "frozen", xSplit: 3, ySplit: 6 }];
  ws2.autoFilter = { from: { row: 6, column: 1 }, to: { row: 6, column: bh.length } };

  // ---- 3. Exp data (ExpType Expense only, this Director, ValueDate in the exp period)
  const ws3 = wb.addWorksheet("Exp Data");
  title(ws3, [`Exp Data (Expense heads) - ${inp.director}`, periods[1]]);
  const eh = ["DocNo", "PayDate", "Head", "Mode", "Narration", "Income", "Expenses", "Emp", "BkgID", "Client", "Project"];
  header(ws3, 5, eh);
  const erows = inp.exps
    .filter((e) => String(e.ExpType ?? "") === "Expense" && sameCode(e.Director, dc))
    .filter((e) => { const d = isoToSerial(e.ValueDate as string); return d !== null && d >= ef && d <= et; })
    .sort((a, b) => String(a.PayDate ?? "").localeCompare(String(b.PayDate ?? "")) || String(a.DocNo ?? "").localeCompare(String(b.DocNo ?? "")));
  let inc = 0, outc = 0;
  for (const e of erows) {
    const g = num(e.Gross as number);
    const income = String(e["R/P"] ?? "") === "Receipt" ? g : 0, expense = String(e["R/P"] ?? "") === "Payment" ? g : 0;
    inc += income; outc += expense;
    const r = ws3.addRow([String(e.DocNo ?? ""), asDate(e.PayDate), String(e.Head ?? ""), String(e.Mode ?? ""), String(e.Narration ?? ""), income || null, expense || null, String(e.Emp ?? ""), String(e.BkgID ?? ""), String(e.Client ?? ""), String(e.Project ?? "")]);
    r.getCell(2).numFmt = "dd-mm-yyyy"; r.getCell(6).numFmt = NUM; r.getCell(7).numFmt = NUM;
  }
  const t3 = ws3.addRow(["Total", "", "", "", "", Math.round(inc), Math.round(outc)]);
  t3.font = { bold: true }; t3.eachCell((c) => (c.border = { top: { style: "thin" } })); t3.getCell(6).numFmt = NUM; t3.getCell(7).numFmt = NUM;
  [12, 12, 18, 12, 40, 14, 14, 24, 14, 26, 26].forEach((w, i) => (ws3.getColumn(i + 1).width = w));
  ws3.views = [{ state: "frozen", ySplit: 5 }];
  ws3.autoFilter = { from: { row: 5, column: 1 }, to: { row: 5, column: eh.length } };

  // ---- 4. Employee data with seat cost (every Emp period under this Director)
  const ws4 = wb.addWorksheet("Employee Data");
  title(ws4, [`Employee Data with Seat Cost - ${inp.director}`, "One row per history period"]);
  const mh = ["Emp", "ReportingHead", "Director", "Status", "Gender", "Branch", "Type", "RevShare", "ExpShare", "DOJ", "ChangeDateFrom", "ChangeDateTo", "Applicable", "ManMonths", "SeatCost"];
  header(ws4, 4, mh);
  const today = new Date().toISOString().slice(0, 10);
  const mine = inp.emps.filter((r) => sameCode(r.calc.director, dc));
  let seat = 0, mm = 0;
  for (const r of mine) {
    seat += r.calc.seatCost; mm += r.calc.manMonths;
    const row = ws4.addRow([r.emp, r.reportingHead, r.calc.director, r.status, r.gender, r.branch, r.type, r.revShare, r.expShare, asDate(r.doj ?? ""), asDate(r.changeDateFrom), asDate(r.changeDateTo ?? today), r.applicable, r.calc.manMonths, Math.round(r.calc.seatCost)]);
    [10, 11, 12].forEach((c) => (row.getCell(c).numFmt = "dd-mm-yyyy"));
    row.getCell(8).numFmt = "0.0%"; row.getCell(9).numFmt = "0.0%"; row.getCell(14).numFmt = "0.00"; row.getCell(15).numFmt = NUM;
  }
  const t4 = ws4.addRow(["Total", "", "", "", "", "", "", "", "", "", "", "", "", Math.round(mm * 100) / 100, Math.round(seat)]);
  t4.font = { bold: true }; t4.eachCell((c) => (c.border = { top: { style: "thin" } })); t4.getCell(14).numFmt = "0.00"; t4.getCell(15).numFmt = NUM;
  mh.forEach((_, i) => (ws4.getColumn(i + 1).width = i < 3 ? 26 : 13));
  ws4.views = [{ state: "frozen", xSplit: 1, ySplit: 4 }];
  ws4.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4, column: mh.length } };

  return Buffer.from(await wb.xlsx.writeBuffer());
}
