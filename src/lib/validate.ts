// Field checks shared by the SCD form, the server and the bulk upload.
import { codeOf, isoToSerial, str } from "./calc/excel";
import { Hierarchy } from "./calc/hierarchy";
import { BKG_INPUT_KEYS, DATE_KEYS, FORM_STATUSES, NUMBER_KEYS, SOLD_STATUSES } from "./fields";
import { employeeNames, priceListFor, type FormData, type MasterData } from "./masters";

export type Errors = Record<string, string>;

/** Coerce raw values (from a form or CSV) to the stored types. Dates become yyyy-mm-dd. */
export function normalize(raw: Record<string, unknown>): FormData {
  const out: FormData = {};
  for (const k of BKG_INPUT_KEYS) {
    const v = raw[k];
    if (v === undefined || v === null || (typeof v === "string" && v.trim() === "")) {
      out[k] = null;
      continue;
    }
    if (DATE_KEYS.has(k)) out[k] = parseDate(v);
    else if (NUMBER_KEYS.has(k)) {
      const n = typeof v === "number" ? v : Number(String(v).replace(/[,\s₹]/g, ""));
      out[k] = Number.isFinite(n) ? n : (String(v) as string);
    } else out[k] = String(v).trim();
  }
  return out;
}

/** Accepts yyyy-mm-dd, dd-mm-yyyy, dd/mm/yyyy, dd-Mon-yyyy or an Excel serial number. */
export function parseDate(v: unknown): string | null {
  if (typeof v === "number") {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000);
    return d.toISOString().slice(0, 10);
  }
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = String(v).trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) return iso(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(s);
  if (m) return iso(+m[3], +m[2], +m[1]);
  m = /^(\d{1,2})[-\s]([A-Za-z]{3})[A-Za-z]*[-\s](\d{4})$/.exec(s);
  if (m) {
    const mon = ["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"].indexOf(m[2].toLowerCase());
    if (mon >= 0) return iso(+m[3], mon + 1, +m[1]);
  }
  if (/^\d{5}(\.\d+)?$/.test(s)) return parseDate(Number(s));
  return s; // left as-is; validation reports it
}
function iso(y: number, mo: number, d: number) {
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return `${y}-${mo}-${d}`;
  return dt.toISOString().slice(0, 10);
}

export interface ValidateOpts {
  mode: "scd" | "bulk";
  /** Units already taken by other rows in the same bulk file. */
  takenInBatch?: Set<string>;
  existingBkgIds?: Set<string>;
}

export function validateBooking(d: FormData, m: MasterData, o: ValidateOpts): Errors {
  const e: Errors = {};
  const req = (k: string, label: string) => {
    if (d[k] === null || d[k] === undefined || str(d[k]) === "") e[k] = `${label} is required`;
  };
  req("BkgLoginDate", "Date of booking");
  req("Emp", "Associate");
  req("Client", "Applicant name");
  req("Project", "Project");
  req("UnitNo", "Unit");
  req("FormStatus", "Form status");
  if (o.mode === "scd") {
    req("ContactNo", "Mobile 1");
    req("SourceOfLead", "Source of lead");
    req("PropertyType", "Property type");
  }

  for (const k of DATE_KEYS) {
    if (d[k] !== null && d[k] !== undefined && isoToSerial(d[k] as string) === null) e[k] = "Use a valid date (dd-mm-yyyy)";
  }
  for (const k of NUMBER_KEYS) {
    const v = d[k];
    if (v === null || v === undefined) continue;
    if (typeof v !== "number") e[k] = "Must be a number";
    else if (v < 0 && k !== "UnitAdj") e[k] = "Cannot be negative";
  }
  if (d.FormStatus && !FORM_STATUSES.includes(str(d.FormStatus) as never)) e.FormStatus = `Must be one of: ${FORM_STATUSES.join(", ")}`;
  if (d.Emp && !employeeNames(m).includes(str(d.Emp))) e.Emp = "Not found in Emp (use Name~Code)";
  else if (d.Emp && d.BkgLoginDate) {
    const day = isoToSerial(d.BkgLoginDate as string);
    const code = codeOf(d.Emp);
    if (day !== null && new Hierarchy(m.employees).rowAt(code, day) < 0)
      e.Emp = `Not employed on ${str(d.BkgLoginDate)} as per Emp (check DOJ / exit date)`;
  }

  const proj = m.projects.find((p) => p.name.toLowerCase() === str(d.Project).toLowerCase());
  if (d.Project && !proj) e.Project = "Unknown project";
  if (proj && d.UnitNo) {
    const unit = m.inventory.find((u) => u.project.toLowerCase() === proj.name.toLowerCase() && u.unitNo === str(d.UnitNo));
    if (!unit) e.UnitNo = "Unit not in inventory for this project";
    else if (SOLD_STATUSES.includes(str(d.FormStatus)) && unit.status !== "Available")
      e.UnitNo = `Unit is ${unit.status.toLowerCase()}`;
    const k = `${proj.name.toLowerCase()}|${str(d.UnitNo)}`;
    if (o.takenInBatch?.has(k) && SOLD_STATUSES.includes(str(d.FormStatus))) e.UnitNo = "Same unit appears twice in this file";
  }
  if (o.mode === "scd" && proj && d.BkgLoginDate && !priceListFor(m, d.Project, d.BkgLoginDate))
    e.BkgLoginDate = "No price list covers this project on this date — ask the back office to update the price list";

  if (d.Email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(str(d.Email))) e.Email = "Invalid email";
  if (d.PAN && !/^[A-Z]{5}[0-9]{4}[A-Z]$/i.test(str(d.PAN))) e.PAN = "PAN should look like ABCDE1234F";
  if (d.Aadhaar && !/^\d{12}$/.test(str(d.Aadhaar).replace(/\s/g, ""))) e.Aadhaar = "Aadhaar should be 12 digits";
  if (d.PIN && !/^\d{6}$/.test(str(d.PIN))) e.PIN = "PIN should be 6 digits";
  for (const k of ["ContactNo", "Mobile2"]) if (d[k] && !/^\+?\d{10,13}$/.test(str(d[k]).replace(/[\s-]/g, ""))) e[k] = "Invalid mobile number";

  if (d.BkgID) {
    if (!/^RV\d{4,}$/.test(str(d.BkgID))) e.BkgID = "BkgID must look like RV0123 (or leave blank to auto-generate)";
    else if (o.existingBkgIds?.has(str(d.BkgID).toUpperCase())) e.BkgID = "BkgID already exists";
  }
  return e;
}
