import "server-only";
import ExcelJS from "exceljs";
import { buildEmp, empCtx, type EmpAction, type EmpUploadItem } from "./changes";
import { CALC_COLOUR, FILL_COLOUR } from "./expLayout";
import { COMPANY } from "./company";

// Emp upload: one row = one action on one employee.
//   New     - add an employee (first history row)          needs Emp Code, Name, ReportingHead, DOJ
//   Change  - new history row from an Effective From date   needs Emp Code, Effective From + the new values
//   Correct - fix details on the current row (no new row)   needs Emp Code + the corrected values
//   Exit    - employee leaves on Exit Date                  needs Emp Code, Exit Date (reportees move one level up,
//             or to "Reportees Move To" when given)
// Blank cells keep the stored value; [clear] empties a field.

export const EMP_UPLOAD_MAX = 300;
export const CLEAR = "[clear]";

/** Template / upload columns: [heading, field, used by]. Headings match the Emp download. */
export const EMP_UPLOAD_COLUMNS: [string, string, string][] = [
  ["Action", "action", "all"],
  ["Emp Code", "code", "all"],
  ["Name", "name", "New"],
  ["Effective From", "effectiveFrom", "Change"],
  ["Exit Date", "exitDate", "Exit"],
  ["Reportees Move To", "moveTo", "Exit"],
  ["ReportingHead", "reportingHead", "New, Change"],
  ["Branch", "branch", "New, Change"],
  ["Type", "type", "New, Change"],
  ["Designation", "designation", "New, Change, Correct"],
  ["Department", "department", "New, Change, Correct"],
  ["RevShare", "revShare", "New, Change"],
  ["ExpShare", "expShare", "New, Change"],
  ["Applicable", "applicable", "New, Change, Correct"],
  ["SeatChargeStart", "seatChargeStart", "New, Change, Correct"],
  ["Company", "company", "New, Change"],
  ["Status", "status", "New, Change"],
  ["Remarks", "remarks", "New, Change, Correct"],
  ["DOJ", "doj", "New, Correct"],
  ["Gender", "gender", "New, Correct"],
  ["Personal Mail ID", "email", "New, Correct"],
  ["Mobile", "mobile", "New, Correct"],
  ["DOB", "dob", "New, Correct"],
  ["Salary", "salary", "New, Correct"],
  ["MinSalary", "minSalary", "New, Correct"],
  ["Father's Name", "fatherName", "New, Correct"],
  ["Mother's Name", "motherName", "New, Correct"],
  ["Permanent Address", "permanentAddress", "New, Correct"],
  ["Current Address", "currentAddress", "New, Correct"],
  ["PAN", "pan", "New, Correct"],
  ["Aadhaar", "aadhaar", "New, Correct"],
  ["Bank Name", "bankName", "New, Correct"],
  ["BankA/cNo", "bankAccount", "New, Correct"],
  ["IFSC", "ifsc", "New, Correct"],
];

const ACTIONS: Record<string, EmpAction> = { new: "create", add: "create", change: "change", history: "change", correct: "correct", exit: "exit" };
const LABEL: Record<EmpAction, string> = { create: "New", change: "Change", correct: "Correct", exit: "Exit" };
const PERIOD_ONLY = new Set(["reportingHead", "branch", "type", "revShare", "expShare", "company", "status"]);
const CORRECT_OK = new Set(["designation", "department", "applicable", "seatChargeStart", "remarks", "doj", "gender", "email", "mobile", "dob", "salary", "minSalary", "fatherName", "motherName", "permanentAddress", "currentAddress", "pan", "aadhaar", "bankName", "bankAccount", "ifsc"]);
const CHANGE_OK = new Set([...PERIOD_ONLY, "designation", "department", "applicable", "seatChargeStart", "remarks"]);

export interface EmpUploadRow {
  row: number;
  action: string;
  emp: string;
  changes: { field: string; from: unknown; to: unknown }[];
  errors: Record<string, string>;
}
export interface EmpUploadCheck { rows: EmpUploadRow[]; items: EmpUploadItem[]; warnings: string[] }

const blank = (v: unknown) => v === null || v === undefined || String(v).trim() === "";
const asText = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : typeof v === "number" ? v : String(v ?? "").trim());
const heading = Object.fromEntries(EMP_UPLOAD_COLUMNS.map(([h, f]) => [h.toLowerCase(), f]));
const headingOf = Object.fromEntries(EMP_UPLOAD_COLUMNS.map(([h, f]) => [f, h]));
const show = (v: unknown) => (v === null || v === undefined || v === "" ? "" : String(v));

export async function checkEmpUpload(rawRows: Record<string, unknown>[]): Promise<EmpUploadCheck> {
  const warnings: string[] = [];
  const cols = new Set(rawRows.flatMap((r) => Object.keys(r)));
  const unknown = [...cols].filter((c) => c && !(c.trim().toLowerCase() in heading));
  if (unknown.length) warnings.push(`These columns are not Emp upload columns and are ignored: ${unknown.join(", ")}`);
  if (rawRows.length > EMP_UPLOAD_MAX) throw new Error(`Up to ${EMP_UPLOAD_MAX} rows per upload - split the file`);

  // read each row into field names; blank = not given, [clear] = empty on purpose
  const parsed = rawRows.map((r, i) => {
    const f: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(r)) {
      const key = heading[k.trim().toLowerCase()];
      if (!key || blank(v)) continue;
      const t = asText(v);
      f[key] = String(t).toLowerCase() === CLEAR ? "" : t;
    }
    return { row: i + 2, f };
  }).filter((p) => Object.keys(p.f).length > 0);

  const ctx = await empCtx();
  // new employees in this file may be used as ReportingHead / Reportees Move To in other rows
  for (const p of parsed) {
    if (ACTIONS[String(p.f.action ?? "").toLowerCase()] === "create" && !blank(p.f.name) && !blank(p.f.code)) ctx.names.add(`${String(p.f.name).trim()}~${String(p.f.code).trim()}`);
  }
  const seen = new Map<string, number>();
  const rows: EmpUploadRow[] = [];
  const items: EmpUploadItem[] = [];

  for (const { row, f } of parsed) {
    const errors: Record<string, string> = {};
    const action = ACTIONS[String(f.action ?? "").toLowerCase()];
    const code = String(f.code ?? "").trim();
    if (!action) errors.Action = "Type New, Change, Correct or Exit";
    if (!code) errors["Emp Code"] = "Emp Code is required";
    else if (seen.has(code.toLowerCase())) errors["Emp Code"] = `Same employee also on row ${seen.get(code.toLowerCase())} - one row per employee per upload`;
    else seen.set(code.toLowerCase(), row);

    // fields that do not belong to this action
    if (action === "correct") {
      const wrong = Object.keys(f).filter((k) => !["action", "code"].includes(k) && !CORRECT_OK.has(k));
      if (wrong.length) errors.Action = `Correct cannot change ${wrong.map((k) => headingOf[k]).join(", ")} - use Change with an Effective From date`;
    }
    if (action === "change") {
      const wrong = Object.keys(f).filter((k) => !["action", "code", "effectiveFrom"].includes(k) && !CHANGE_OK.has(k));
      if (wrong.length) errors.Action = `Change starts a new history row and cannot change ${wrong.map((k) => headingOf[k]).join(", ")} - use Correct for personal details`;
    }

    let built: ReturnType<typeof buildEmp> | null = null;
    if (action && code && !errors.Action) {
      const raw: Record<string, unknown> = { ...f };
      if (action === "exit") {
        const cur = ctx.current.find((c) => (c.emp.split("~")[1] ?? "").toLowerCase() === code.toLowerCase());
        if (f.moveTo && cur) {
          const to = String(f.moveTo);
          if (!ctx.names.has(to)) errors["Reportees Move To"] = "Not found in Emp (use Name~Code)";
          raw.reassign = ctx.current.filter((c) => c.changeDateTo === null && c.reportingHead === cur.emp).map((c) => ({ emp: c.emp, newHead: to }));
        }
      }
      built = buildEmp(action, raw, ctx);
      for (const [k, v] of Object.entries(built.errors)) errors[headingOf[k] ?? (k.startsWith("reassign:") ? `Reportee ${k.slice(9)}` : k)] = v;
    }

    const changes: EmpUploadRow["changes"] = [];
    if (built && !Object.keys(errors).length) {
      const d = built.data;
      const b = (built.before ?? {}) as Record<string, unknown>;
      if (action === "create") for (const [k, v] of Object.entries(d)) { if (!blank(v) && headingOf[k]) changes.push({ field: headingOf[k], from: "", to: v }); }
      if (action === "change") {
        changes.push({ field: "Effective From", from: show(b.changeDateFrom), to: d.effectiveFrom });
        for (const [k, v] of Object.entries(d.changes as Record<string, unknown>)) changes.push({ field: headingOf[k] ?? k, from: show(b[k]), to: v });
      }
      if (action === "correct") for (const [k, v] of Object.entries(d.changes as Record<string, unknown>)) changes.push({ field: headingOf[k] ?? k, from: show(b[k]), to: v });
      if (action === "exit") {
        changes.push({ field: "Exit Date", from: "", to: d.exitDate });
        for (const r of d.reassign as { emp: string; newHead: string }[]) changes.push({ field: `Reportee ${r.emp}`, from: show(b.emp), to: r.newHead });
      }
      items.push({ row, action, data: d });
    }
    rows.push({
      row,
      action: action ? LABEL[action] : String(f.action ?? ""),
      emp: action === "create" ? `${String(f.name ?? "")}~${code}` : String((built?.before as { emp?: string } | null)?.emp ?? code),
      changes,
      errors,
    });
  }
  return { rows, items, warnings };
}

const fill = (argb: string): ExcelJS.Fill => ({ type: "pattern", pattern: "solid", fgColor: { argb } });

/** Upload template: green headings (typed by hand), examples, instructions and a grey reference list of current employees. */
export async function empTemplateXlsx(current: { emp: string; reportingHead: string; branch: string | null; designation: string | null; director: string; active: boolean }[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Emp upload");
  ws.columns = EMP_UPLOAD_COLUMNS.map(([h]) => ({ header: h, key: h, width: Math.max(12, h.length + 3) }));
  const hdr = ws.getRow(1);
  hdr.font = { bold: true };
  EMP_UPLOAD_COLUMNS.forEach(([h, , use], i) => {
    const c = hdr.getCell(i + 1);
    c.fill = fill(FILL_COLOUR);
    c.note = `${h}: used for ${use}`;
  });
  const top = COMPANY.topCode;
  const head = current.find((c) => c.emp.endsWith(`~${top}`))?.emp ?? `Head Name~${top}`;
  const examples: Record<string, unknown>[] = [
    { Action: "New", "Emp Code": "100999", Name: "New Joiner", ReportingHead: head, Branch: "Noida", Type: "Sales", Designation: "BDE", DOJ: "01-12-2026", Gender: "Female", Mobile: "9800000000", "Personal Mail ID": "joiner@example.com" },
    { Action: "Change", "Emp Code": "100999", "Effective From": "01-03-2027", ReportingHead: head, Designation: "Sales Manager" },
    { Action: "Correct", "Emp Code": "100999", Mobile: "9811111111", IFSC: "HDFC0001234" },
    { Action: "Exit", "Emp Code": "100999", "Exit Date": "30-06-2027" },
  ];
  examples.forEach((r) => ws.addRow(EMP_UPLOAD_COLUMNS.map(([h]) => r[h] ?? "")));
  ws.views = [{ state: "frozen", ySplit: 1, xSplit: 2 }];

  const help = wb.addWorksheet("Instructions");
  [
    ["HOW TO USE THIS TEMPLATE"],
    ["Delete the 4 example rows (rows 2-5) before uploading. One row = one action on one employee; one row per employee per upload. Dates dd-mm-yyyy. Up to 300 rows."],
    ["Action = New: adds an employee. Needs Emp Code (new, unique), Name, ReportingHead (Name~Code) and DOJ. The first history row starts on the DOJ."],
    ["Action = Change: starts a NEW HISTORY ROW from 'Effective From' (the current row closes the day before). Fill only what changes: ReportingHead, Branch, Type, RevShare, ExpShare, Designation, Department, Applicable, SeatChargeStart, Company, Status, Remarks. Bookings before that date keep the old hierarchy."],
    ["Action = Correct: fixes details on the CURRENT row without a new history row - personal details (DOJ, Mobile, PAN, Bank ...) and Designation, Department, Applicable, SeatChargeStart, Remarks. Reporting head or shares cannot be corrected this way; use Change."],
    ["Action = Exit: the employee leaves on 'Exit Date'. Everyone reporting to them moves one level up from the next day, or to 'Reportees Move To' (Name~Code) when filled."],
    ["Blank cells keep the stored value. To empty a field on purpose type [clear]. RevShare / ExpShare are fractions: 1 = 100%."],
    ["Green headings = typed by hand and read on upload (every column of this template). The 'Current employees' sheet is for reference only (grey = built in) and is not read."],
    [`HR uploads go to the Master for approval as one change; the Master's uploads apply at once. Nothing is saved unless every row passes.`],
  ].forEach((r) => help.addRow(r));
  help.getColumn(1).width = 160;
  help.getRow(9).getCell(1).fill = fill(FILL_COLOUR);

  const ref = wb.addWorksheet("Current employees");
  ref.columns = [
    { header: "Emp", key: "emp", width: 30 }, { header: "Emp Code", key: "code", width: 12 }, { header: "ReportingHead", key: "rh", width: 30 },
    { header: "Director", key: "dir", width: 30 }, { header: "Branch", key: "br", width: 14 }, { header: "Designation", key: "des", width: 24 }, { header: "Active", key: "act", width: 8 },
  ];
  for (const c of current) ref.addRow({ emp: c.emp, code: c.emp.split("~")[1] ?? "", rh: c.reportingHead, dir: c.director, br: c.branch, des: c.designation, act: c.active ? "Y" : "N" });
  const rh = ref.getRow(1);
  rh.font = { bold: true };
  for (let i = 1; i <= 7; i++) rh.getCell(i).fill = fill(CALC_COLOUR);
  ref.views = [{ state: "frozen", ySplit: 1 }];
  ref.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: 7 } };
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export function empTemplateCsv(): string {
  return EMP_UPLOAD_COLUMNS.map(([h]) => (/[",]/.test(h) ? `"${h.replace(/"/g, '""')}"` : h)).join(",");
}
