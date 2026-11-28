import "server-only";
import ExcelJS from "exceljs";
import { BKG_COLUMNS, BKG_INPUT_KEYS, DATE_KEYS, colName } from "@/lib/fields";
import { CALC_CELL_COLOUR, CALC_COLOUR, EXP_DOWNLOAD_COLUMNS, EXP_GROUP_COL, EXP_REMARK_COL, FILL_COLOUR, REMARK_COLOUR, colNote, kindOfCol } from "@/lib/expLayout";
import { sortBkgByDate } from "@/lib/bkgFilter";
import type { employeesWithCalc } from "@/lib/data";
import { COMPANY, SEAT_CHARGED } from "@/lib/company";

// One place that builds the Bkg and Exp workbooks, so the Bkg, Exp and Data exceptions downloads always have the same format.
type Row = Record<string, unknown>;

/** Written in Bkg Date order with the latest booking at the bottom (the list on screen shows the latest on top). */
/**
 * eventDates (the RealV / TRPL Data file): CancelDate and RACloseDate are added after FormStatus - the month the cancellation / RA close
 * counts in (from the booking event log). Green: a changed date is read on upload and moves that event.
 */
export async function bkgWorkbook(rowsAny: Row[], into?: ExcelJS.Workbook, eventDates?: Map<string, { cancel?: { date: string }; raClose?: { date: string } }>): Promise<ArrayBuffer> {
  const rows = sortBkgByDate(rowsAny, "asc");
  const wb = into ?? new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Bkg");
  const EXTRA = ["CancelDate", "RACloseDate"];
  // the Data file's own order: the event dates after FormStatus, Project and Builder before Client, SourceOfLead and PropertyType before RC/RA
  // (the upload reads columns by their heading, so the order does not matter there)
  const MOVED = new Set(["SourceOfLead", "PropertyType", "Project", "Builder"]);
  const cols = eventDates
    ? BKG_COLUMNS.filter((c) => !MOVED.has(c)).flatMap((c) =>
        c === "FormStatus" ? [c, ...EXTRA] : c === "Client" ? ["Project", "Builder", c] : c === "RC/RA" ? ["SourceOfLead", "PropertyType", c] : [c])
    : BKG_COLUMNS;
  const isDate = (c: string) => DATE_KEYS.has(c) || EXTRA.includes(c);
  ws.columns = cols.map((c) => ({ header: EXTRA.includes(c) ? c : colName(c), key: c, width: Math.max(10, c.length + 2), style: isDate(c) ? { numFmt: "dd-mm-yyyy" } : {} }));
  const asDate = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T00:00:00Z`) : v ?? null);
  for (const r of rows) {
    const ev = eventDates?.get(String(r.BkgID ?? "").trim().toUpperCase());
    ws.addRow(Object.fromEntries(cols.map((c) => {
      if (c === "CancelDate") return [c, asDate(ev?.cancel?.date)];
      if (c === "RACloseDate") return [c, asDate(ev?.raClose?.date)];
      const v = r[c];
      return [c, DATE_KEYS.has(c) ? asDate(v) : v ?? null];
    })));
  }
  // Headings: light green = typed by hand (read by the Bkg upload), light grey = derived (calculated, ignored on upload)
  const typed = new Set([...BKG_INPUT_KEYS, ...EXTRA]);
  const hdr = ws.getRow(1);
  hdr.font = { bold: true };
  cols.forEach((c, i) => {
    const cell = hdr.getCell(i + 1);
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: typed.has(c) ? FILL_COLOUR : CALC_COLOUR } };
    if (c === "CancelDate") cell.note = "The month the cancellation counts in (Monthly movement). Filled by the site when FormStatus becomes Cancel; type another date to move it. Blank = no change.";
    if (c === "RACloseDate") cell.note = "The month the RA close counts in (Monthly movement). Filled by the site when RA% moves above 0; type another date to move it. Blank = no change.";
  });
  ws.views = [{ state: "frozen", ySplit: 1 }];
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length } };
  if (into) return new ArrayBuffer(0);

  const help = wb.addWorksheet("Legend");
  [
    ["HOW TO READ THIS FILE"],
    ["Light green headings = entered by hand on the booking (or filled from the masters when the booking is made). These are the columns the Bkg upload reads."],
    ["Light grey headings = derived columns, calculated by the system (costing totals, Director, revenue, receipts, dues, revenue share). They are ignored on upload even if you change them."],
  ].forEach((r) => help.addRow(r));
  help.getRow(2).getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: FILL_COLOUR } };
  help.getRow(3).getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: CALC_COLOUR } };
  help.getColumn(1).width = 140;
  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}

/**
 * Exp rows are given newest first (as listed) and written oldest first, like the Excel sheet.
 * Data Exception Remarks and Group come first; headings are green (type by hand, read on upload) or grey (built in, ignored on upload).
 * Emp and Project are the values typed on the entry (when `stored` is given), so an unchanged file uploads as no change.
 * An entry without a DocNo shows its row id there (as the Exp list does); typing that number back identifies the entry on upload.
 */
export async function expWorkbook(rowsNewestFirst: Row[], remarks: Map<number, string> = new Map(), stored?: Map<number, { emp: string | null; project: string | null }>, into?: ExcelJS.Workbook): Promise<ArrayBuffer> {
  const wb = into ?? new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Exp");
  const dates = new Set(["PayDate", "ValueDate", "Chq/UTR Date"]);
  ws.columns = EXP_DOWNLOAD_COLUMNS.map((c) => {
    const kind = kindOfCol(c);
    const style: Partial<ExcelJS.Style> = {};
    if (dates.has(c)) style.numFmt = "dd-mm-yyyy";
    if (kind === "calc") style.fill = { type: "pattern", pattern: "solid", fgColor: { argb: CALC_CELL_COLOUR } };
    if (kind === "remark") style.fill = { type: "pattern", pattern: "solid", fgColor: { argb: REMARK_COLOUR } };
    return { header: c, key: c, width: c === EXP_REMARK_COL ? 38 : Math.max(10, c.length + 2), style };
  });
  for (const r of [...rowsNewestFirst].reverse()) {
    const id = Number(r.id);
    ws.addRow(Object.fromEntries(EXP_DOWNLOAD_COLUMNS.map((c) => {
      if (c === EXP_REMARK_COL) return [c, remarks.get(id) ?? null];
      if (c === EXP_GROUP_COL) return [c, null];
      if (c === "DocNo") return [c, r.DocNo || (Number.isFinite(id) ? id : null)];
      if (stored && stored.has(id) && (c === "Emp" || c === "Project")) return [c, c === "Emp" ? stored.get(id)!.emp : stored.get(id)!.project];
      return [c, dates.has(c) && typeof r[c] === "string" ? new Date(`${r[c]}T00:00:00Z`) : r[c] ?? null];
    })));
  }
  const hdr = ws.getRow(1);
  hdr.font = { bold: true };
  EXP_DOWNLOAD_COLUMNS.forEach((c, i) => {
    const cell = hdr.getCell(i + 1);
    const kind = kindOfCol(c);
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: kind === "fill" ? FILL_COLOUR : kind === "remark" ? REMARK_COLOUR : CALC_COLOUR } };
    cell.note = colNote(c);
  });
  ws.views = [{ state: "frozen", ySplit: 1, xSplit: 3 }];
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: EXP_DOWNLOAD_COLUMNS.length } };
  if (into) return new ArrayBuffer(0);

  const help = wb.addWorksheet("Legend");
  [
    ["HOW TO USE THIS FILE"],
    ["Green headings = columns you type or correct by hand; they are read when you upload this file. Grey headings and grey cells = built in (calculated); they are ignored on upload even if you change them. Yellow = Data Exception Remarks: what is missing or wrong in that entry (built in, ignored on upload)."],
    ["Filter the Data Exception Remarks column to see the entries to complete, fill in the green cells, then upload the file on the Exp bulk upload page. Up to 500 rows per upload - keep only the rows you want to upload (or filter and copy them to a new file), or upload in parts."],
    ["Group (empty): type a label on rows that must become ONE document. To add a new entry to an existing document, give the SAME label to the existing row (keep its DocNo) and to the new row (leave DocNo blank). The old entry's DocNo does not change."],
    ["An entry that has no DocNo shows its row id in the DocNo column. Keep that number as it is - it identifies the entry."],
    ["To empty a cell on purpose type [clear]. Dates dd-mm-yyyy. The upload checks every row; nothing is saved unless all rows pass."],
    ["Columns, in this order, are the same as in the upload template (which leaves out the grey ones). ExpMonth is green: blank = built in from PayDate; a month typed there (yyyy-mm) is kept as typed."],
  ].forEach((r) => help.addRow(r));
  help.getColumn(1).width = 160;
  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}

/** Emp table in the same column layout as the Excel Emp sheet (contains personal data: Master and HR only). */
export async function empWorkbook(rows: Awaited<ReturnType<typeof employeesWithCalc>>, into?: ExcelJS.Workbook): Promise<ArrayBuffer> {
  const cols: [string, (r: (typeof rows)[number]) => unknown][] = [
    // typed columns that make a row an Emp upload action (blank Action = reference row, ignored on upload)
    ...([["Action", () => null], ["Emp Code", (r) => r.emp.split("~")[1] ?? ""], ["Name", () => null], ["Effective From", () => null], ["Exit Date", () => null], ["Reportees Move To", () => null]] as [string, (r: (typeof rows)[number]) => unknown][]),
    ["Applicable", (r) => r.applicable], ["ManMonths", (r) => r.calc.manMonths], ...(SEAT_CHARGED ? [["SeatCost", (r: (typeof rows)[number]) => r.calc.seatCost] as [string, (r: (typeof rows)[number]) => unknown]] : []),
    ["Emp", (r) => r.emp], ["ReportingHead", (r) => r.reportingHead], ["Director", (r) => r.calc.director],
    ["Status", (r) => r.status], ["Gender", (r) => r.gender], ["Branch", (r) => r.branch], ["Type", (r) => r.type],
    ["RevShare", (r) => r.revShare], ["ExpShare", (r) => r.expShare], ["DOJ", (r) => r.doj],
    ["ChangeDateFrom", (r) => r.changeDateFrom], ["ChangeDateTo", (r) => r.changeDateTo ?? new Date().toISOString().slice(0, 10)],
    ["DOExit/Change", (r) => r.exitDate], ["DaysWorked", (r) => r.calc.daysWorked], ["Company", (r) => r.company],
    ["Designation", (r) => r.designation], ["Department", (r) => r.department], ["Remarks", (r) => r.remarks],
    ["Mobile", (r) => r.mobile], ["Personal Mail ID", (r) => r.email], ["DOB", (r) => r.dob], ["Salary", (r) => r.salary],
    ["MinSalary", (r) => r.minSalary], ["Father's Name", (r) => r.fatherName], ["Mother's Name", (r) => r.motherName],
    ["Permanent Address", (r) => r.permanentAddress], ["Current Address", (r) => r.currentAddress], ["PAN", (r) => r.pan],
    ["Aadhaar", (r) => r.aadhaar], ["Bank Name", (r) => r.bankName], ["BankA/cNo", (r) => r.bankAccount], ["IFSC", (r) => r.ifsc],
    ["SeatChargeStart", (r) => r.seatChargeStart], ["Key", (r) => r.calc.key],
  ];
  const dateCols = new Set(["DOJ", "ChangeDateFrom", "ChangeDateTo", "DOExit/Change", "DOB", "SeatChargeStart", "Effective From", "Exit Date"]);
  const wb = into ?? new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Emp");
  ws.columns = cols.map(([h]) => ({ header: h, key: h, width: Math.max(10, h.length + 2), style: dateCols.has(h) ? { numFmt: "dd-mm-yyyy" } : {} }));
  for (const r of rows)
    ws.addRow(Object.fromEntries(cols.map(([h, f]) => {
      const v = f(r);
      return [h, dateCols.has(h) && typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T00:00:00Z`) : v ?? null];
    })));
  // Headings: light green = typed by hand, light grey = derived by the system (same colours as the Bkg and Exp downloads)
  const derived = new Set(["ManMonths", "SeatCost", "Director", "ChangeDateFrom", "ChangeDateTo", "DOExit/Change", "DaysWorked", "Key"]);
  const hdr = ws.getRow(1);
  hdr.font = { bold: true };
  cols.forEach(([h], i) => { hdr.getCell(i + 1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: derived.has(h) ? CALC_COLOUR : FILL_COLOUR } }; });
  ws.views = [{ state: "frozen", ySplit: 1 }];
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length } };
  if (into) return new ArrayBuffer(0);
  const help = wb.addWorksheet("Legend");
  [
    ["HOW TO READ THIS FILE"],
    ["Light green headings = typed by hand and read on upload (Action, Emp Code, Name, Effective From, Exit Date, Reportees Move To and the Emp details)."],
    ["Light grey headings = derived by the system: Director, history dates (ChangeDateFrom / ChangeDateTo / DOExit-Change), days worked, man-months, seat cost, key."],
    ["One row per history period of each employee. To upload changes, type an Action on the employee's LATEST row (New, Change, Correct or Exit) and edit only the cells that change, then upload the file on Emp > Upload Emp. Rows with a blank Action are reference only."],
    ["Change = new history row from Effective From (ReportingHead, Branch, Type, RevShare, ExpShare, Status ... change this way). Correct = fix details on the current row (Applicable, Designation, personal details ...). Exit = leaves on Exit Date. New = add a row at the bottom with Emp Code, Name, ReportingHead and DOJ. [clear] empties a cell."],
  ].forEach((r) => help.addRow(r));
  help.getRow(2).getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: FILL_COLOUR } };
  help.getRow(3).getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: CALC_COLOUR } };
  help.getColumn(1).width = 150;
  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}

/** One file with the three tables as sheets Bkg, Exp and Emp (each keeps its own heading colours; no Legend sheets). */
export async function combinedWorkbook(parts: { bkg: Row[]; exp: Row[]; emp: Awaited<ReturnType<typeof employeesWithCalc>>; remarks: Map<number, string>; stored?: Map<number, { emp: string | null; project: string | null }>; eventDates?: Map<string, { cancel?: { date: string }; raClose?: { date: string } }> }): Promise<Uint8Array> {
  const out = new ExcelJS.Workbook();
  await bkgWorkbook(parts.bkg, out, parts.eventDates);
  await expWorkbook(parts.exp, parts.remarks, parts.stored, out);
  await empWorkbook(parts.emp, out);
  return new Uint8Array((await out.xlsx.writeBuffer()) as ArrayBuffer);
}

export const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
export const stampDate = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10); // India date
/** "RealV Data 2026-11-28" / "TRPL Data 2026-11-28": the name of the Bkg + Exp + Emp file. */
export const dataFileName = () => `${COMPANY.key === "trpl" ? "TRPL" : "RealV"} Data ${stampDate()}`;
