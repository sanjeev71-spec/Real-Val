// Individual P&L pack for one Director: 4 sheets (P&L summary TL-wise, Bkg Data, Exp Data, Employee Data) as an .xlsx.
import ExcelJS from "exceljs";
import { computeTlSummary, type PnlData } from "./calc/pnl";
import { BKG_INPUT_KEYS, NUMBER_KEYS, colName } from "./fields";
import { CALC_COLOUR, EXP_FILL_COLS, FILL_COLOUR } from "./expLayout";
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
  storedExp?: Map<number, { emp: string | null; project: string | null }>;
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

  // ---- 2. Bkg data: heading in row 1 so the sheet can be uploaded as it is (Upload Bkg / the Bkg + Exp + Emp file).
  // Green headings = typed columns the upload reads; grey = calculated, ignored on upload (same colours as the Bkg download).
  // Comm Paid per booking = Expenses - Income of the Exp rows with Head "Comm Paid" (the sum of their SignedGross, sign flipped to show paid as positive).
  const commPaid = new Map<string, number>();
  for (const e of inp.exps) {
    if (String(e.Head ?? "").trim().toLowerCase() !== "comm paid") continue;
    const id = String(e.BkgID ?? "").trim().toUpperCase();
    if (!id) continue;
    const g = num(e.Gross as number), rp = String(e["R/P"] ?? "");
    commPaid.set(id, (commPaid.get(id) ?? 0) + (rp === "Payment" ? g : rp === "Receipt" ? -g : 0));
  }
  const ws2 = wb.addWorksheet("Bkg Data");
  const typedKeys = new Set(BKG_INPUT_KEYS);
  // [key, header]: a real Bkg key is read by the upload when typed (green); the rest are pack calculations (grey)
  const K = (k: string): [string, string] => [k, colName(k)];
  const cols: [string, string][] = [
    K("BkgMonth"), K("BkgID"), K("Emp"), K("Client"), K("Project"), K("FormStatus"), K("PaymentPlan"), K("Area"),
    K("BSPPSF"), K("InaugralDiscountPSF"), K("NPVDiscountPSF"), K("SchemeDiscountPSF"), K("FormRevisedPSF"), K("AgreementRevisedPSF"), K("PaymentPlanDiscountPSF"), K("OnFormDiscountPSF"),
    K("NetBSPPSF"), K("PLCPSF"), K("IFMSPSF"), K("PowerBackupPSF"), K("SinkingFundClubPSF"), K("OtherChargesPSF"), K("TotalChargesPSF"), K("TotalCostPSF"), K("TotalCostAmt"), K("GST"), K("TCWithGST"),
    K("RC/RA"), K("SPD"), K("ChqAmt"), K("Recd%"), K("DSlab"), K("DirectorRevenue"), K("DirectorSplRevenue"), K("SpinToWin"), K("IncentivePOC"), K("IncentiveRV"), K("IncentiveBuilder"),
    ["p:rev", "DirectorRevenue + Incentives"], ["p:revRA", "Director Revenue RA"], ["p:sharing", "Director Sharing"], ["p:share", "Director Share"], ["p:shareRA", "Director Share RA"],
    ["p:ov", "Override_Share"], ["p:ovRA", "Override_Share RA"], ["p:tot", "Total Share (incl. Override)"], ["p:totRA", "Total Share RA (incl. Override)"],
    ["p:comm", "Comm Paid"], ["p:basis", "Basis"],
  ];
  const keys = cols.map((c) => c[0]);
  const hdr2 = ws2.getRow(1);
  cols.forEach(([k, h], i) => {
    const cell = hdr2.getCell(i + 1);
    cell.value = h;
    cell.font = { bold: true };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: typedKeys.has(k) ? FILL_COLOUR : CALC_COLOUR } };
  });
  const TEXT = new Set(["BkgID", "Emp", "Client", "Project", "FormStatus", "PaymentPlan", "RC/RA", "p:basis"]);
  const SUMKEYS = new Set(["TotalCostAmt", "GST", "TCWithGST", "SPD", "ChqAmt", "DSlab", "DirectorRevenue", "DirectorSplRevenue", "SpinToWin", "IncentivePOC", "IncentiveRV", "IncentiveBuilder",
    "p:rev", "p:revRA", "p:share", "p:shareRA", "p:ov", "p:ovRA", "p:tot", "p:totRA", "p:comm"]);
  const CHAINONLY = new Set(["TotalCostAmt", "GST", "TCWithGST", "DirectorRevenue", "DirectorSplRevenue", "SpinToWin", "IncentivePOC", "IncentiveRV", "IncentiveBuilder"]);
  const totals: Record<string, number> = {};
  for (const d of det) {
    const b = d.b;
    const c = d.chain;
    const p: Record<string, string | number | null> = {
      "p:rev": c ? d.rev : null, "p:revRA": c ? d.revRA : null, "p:sharing": c ? d.sharing : null, "p:share": c ? d.share : null, "p:shareRA": c ? d.shareRA : null,
      "p:ov": d.ovShare, "p:ovRA": d.ovRA, "p:tot": d.share + d.ovShare, "p:totRA": d.shareRA + d.ovRA,
      "p:comm": commPaid.get(String(b.BkgID ?? "").trim().toUpperCase()) ?? 0,
      "p:basis": c && d.override ? "Chain + Override" : c ? "Chain" : "Override",
    };
    const vals = keys.map((k): string | number | Date | null => {
      if (k.startsWith("p:")) return p[k];
      if (k === "BkgMonth") return asDate(b.BkgMonth) as Date | string;
      if (CHAINONLY.has(k) && !c) return null;
      if (TEXT.has(k)) return String(b[k] ?? "");
      const v = b[k];
      if (v === null || v === undefined || v === "") return null;
      // some typed number columns hold text on old bookings (e.g. DSlab): keep it as it is so an upload shows no change
      if (typeof v === "number") return v;
      if (k === "Recd%" || NUMBER_KEYS.has(k)) { const n = Number(String(v).replace(/[,\s₹]/g, "")); return Number.isFinite(n) ? n : String(v); }
      return String(v);
    });
    if (d.sold) keys.forEach((k, i) => { const v = vals[i]; if (SUMKEYS.has(k) && typeof v === "number") totals[k] = (totals[k] ?? 0) + v; });
    const r = ws2.addRow(vals);
    keys.forEach((k, i) => {
      const cell = r.getCell(i + 1);
      if (k === "BkgMonth") cell.numFmt = "mmm-yyyy";
      else if (k === "Recd%" || k === "p:sharing") cell.numFmt = "0.0%";
      else if (k === "Area") cell.numFmt = "#,##0.00";
      else if (!TEXT.has(k)) cell.numFmt = NUM;
    });
  }
  const tr = ws2.addRow(keys.map((k, i) => (i === 0 ? "Total (Live + Not Live only)" : SUMKEYS.has(k) ? Math.round(totals[k] ?? 0) : "")));
  tr.font = { bold: true };
  tr.eachCell((c, i) => { c.border = { top: { style: "thin" } }; if (i > 1) c.numFmt = NUM; });
  keys.forEach((k, i) => (ws2.getColumn(i + 1).width = k === "BkgMonth" || k === "BkgID" ? 12 : k === "Emp" ? 26 : k === "Client" || k === "Project" ? 28 : k === "p:basis" ? 18 : 14));
  ws2.views = [{ state: "frozen", xSplit: 4, ySplit: 1 }];
  ws2.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: keys.length } };

  // ---- 3. Exp data (ExpType Expense only, this Director, ValueDate in the exp period). Heading in row 1 so it uploads as it is
  // (green = typed, read by the Exp upload; grey = calculated, ignored). Income / Expenses show Gross by R/P; R/P and Gross are what the upload reads.
  const ws3 = wb.addWorksheet("Exp Data");
  const eh = ["DocNo", "PayDate", "Head", "Mode", "Narration", "R/P", "Gross", "Income", "Expenses", "Emp", "BkgID", "Client", "Project"];
  const hdrRow = (ws: ExcelJS.Worksheet, cols: string[], typed: (c: string) => boolean) => {
    const r = ws.getRow(1);
    cols.forEach((c, i) => {
      const cell = r.getCell(i + 1);
      cell.value = c;
      cell.font = { bold: true };
      cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: typed(c) ? FILL_COLOUR : CALC_COLOUR } };
    });
  };
  hdrRow(ws3, eh, (c) => EXP_FILL_COLS.has(c));
  const erows = inp.exps
    .filter((e) => String(e.ExpType ?? "") === "Expense" && sameCode(e.Director, dc))
    .filter((e) => { const d = isoToSerial(e.ValueDate as string); return d !== null && d >= ef && d <= et; })
    .sort((a, b) => String(a.PayDate ?? "").localeCompare(String(b.PayDate ?? "")) || String(a.DocNo ?? "").localeCompare(String(b.DocNo ?? "")));
  let inc = 0, outc = 0;
  for (const e of erows) {
    const g = num(e.Gross as number);
    const income = String(e["R/P"] ?? "") === "Receipt" ? g : 0, expense = String(e["R/P"] ?? "") === "Payment" ? g : 0;
    inc += income; outc += expense;
    const id = Number(e.id);
    const st = inp.storedExp?.get(id); // Emp and Project as typed on the entry, so an unchanged file uploads as no change
    const r = ws3.addRow([e.DocNo || (Number.isFinite(id) ? id : ""), asDate(e.PayDate), String(e.Head ?? ""), String(e.Mode ?? ""), String(e.Narration ?? ""), String(e["R/P"] ?? ""), g,
      income || null, expense || null, st ? st.emp ?? "" : String(e.Emp ?? ""), String(e.BkgID ?? ""), String(e.Client ?? ""), st ? st.project ?? "" : String(e.Project ?? "")]);
    r.getCell(2).numFmt = "dd-mm-yyyy"; [7, 8, 9].forEach((n) => (r.getCell(n).numFmt = NUM));
  }
  const t3 = ws3.addRow(["Total (Expense heads)", "", "", "", "", "", "", Math.round(inc), Math.round(outc)]);
  t3.font = { bold: true }; t3.eachCell((c) => (c.border = { top: { style: "thin" } })); t3.getCell(8).numFmt = NUM; t3.getCell(9).numFmt = NUM;
  [14, 12, 18, 12, 40, 10, 14, 14, 14, 24, 14, 26, 26].forEach((w, i) => (ws3.getColumn(i + 1).width = w));
  ws3.views = [{ state: "frozen", ySplit: 1 }];
  ws3.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: eh.length } };

  // ---- 4. Employee data with seat cost (every Emp period under this Director). Same layout as the Emp sheet of the Bkg + Exp + Emp file:
  // a row is applied on upload only when its Action is filled (New / Change / Correct / Exit); blank Action = reference row.
  const ws4 = wb.addWorksheet("Employee Data");
  const mh = ["Action", "Emp Code", "Name", "Effective From", "Exit Date", "Reportees Move To", "Emp", "ReportingHead", "Director", "Status", "Gender", "Branch", "Type", "RevShare", "ExpShare", "DOJ", "ChangeDateFrom", "ChangeDateTo", "Applicable", "ManMonths", "SeatCost"];
  const calcEmp = new Set(["Director", "ChangeDateFrom", "ChangeDateTo", "ManMonths", "SeatCost"]);
  hdrRow(ws4, mh, (c) => !calcEmp.has(c));
  const today = new Date().toISOString().slice(0, 10);
  const mine = inp.emps.filter((r) => sameCode(r.calc.director, dc));
  let seat = 0, mm = 0;
  for (const r of mine) {
    seat += r.calc.seatCost; mm += r.calc.manMonths;
    const row = ws4.addRow([null, r.emp.split("~")[1] ?? "", null, null, null, null, r.emp, r.reportingHead, r.calc.director, r.status, r.gender, r.branch, r.type, r.revShare, r.expShare, asDate(r.doj ?? ""), asDate(r.changeDateFrom), asDate(r.changeDateTo ?? today), r.applicable, r.calc.manMonths, Math.round(r.calc.seatCost)]);
    [4, 5, 16, 17, 18].forEach((c) => (row.getCell(c).numFmt = "dd-mm-yyyy"));
    row.getCell(14).numFmt = "0.0%"; row.getCell(15).numFmt = "0.0%"; row.getCell(20).numFmt = "0.00"; row.getCell(21).numFmt = NUM;
  }
  const t4 = ws4.addRow(mh.map((_, i) => (i === 0 ? "Total (Employee Data)" : i === 19 ? Math.round(mm * 100) / 100 : i === 20 ? Math.round(seat) : "")));
  t4.font = { bold: true }; t4.eachCell((c) => (c.border = { top: { style: "thin" } })); t4.getCell(20).numFmt = "0.00"; t4.getCell(21).numFmt = NUM;
  mh.forEach((_, i) => (ws4.getColumn(i + 1).width = i === 6 || i === 7 || i === 8 || i === 2 || i === 5 ? 26 : 13));
  ws4.views = [{ state: "frozen", xSplit: 1, ySplit: 1 }];
  ws4.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: mh.length } };

  const lg = wb.addWorksheet("Legend");
  [
    `Bkg Data / Exp Data / Employee Data - ${inp.director}`, periods[0], periods[1],
    "Light green headings = typed columns, read by the Bkg upload (Upload Bkg, or the Bkg sheet of the Bkg + Exp + Emp file). Light grey headings = calculated, ignored on upload.",
    "Blank cells keep the stored value; [clear] empties a field. Only bookings of this Director's chain or override are in the sheet, and the Total row is skipped on upload.",
    "DirectorRevenue + Incentives = DirectorRevenue + DirectorSplRevenue + SpinToWin + " + colName("IncentiveRV") + ". Director Share (ShareAmt) = DirectorRevenue x Director Sharing + DirectorSplRevenue + SpinToWin + " + colName("IncentiveRV") + ". Director Share RA = Director Share x RA%. Total Share adds the Override share.",
    "Comm Paid = Expenses - Income of the Exp rows of the booking (same BkgID) with Head Comm Paid, all Directors and dates.",
    "Basis: Chain = the Director is in the revenue-share chain; Override = the Director gets an override share only (revenue columns left blank).",
    "Totals of Bkg Data count Live and Not Live bookings only.",
    "Exp Data: R/P and Gross are what the Exp upload reads (Income / Expenses are calculated). Employee Data: a row is applied on upload only when its Action (New, Change, Correct or Exit) is filled; use the Emp sheet of the Bkg + Exp + Emp file page. Total rows are skipped on upload.",
  ].forEach((t, i) => { const c = lg.getCell(i + 1, 1); c.value = t; if (i === 0) c.font = { bold: true, size: 14 }; });
  lg.getColumn(1).width = 150;
  lg.getCell(3, 1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: FILL_COLOUR } };

  return Buffer.from(await wb.xlsx.writeBuffer());
}
