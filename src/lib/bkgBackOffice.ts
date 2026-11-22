// Back-office booking sheet (TRPL) -> standard Bkg upload rows. Used by the Bkg upload when the file has the back-office headers.
type Row = Record<string, unknown>;

export const isBackOffice = (raw: Row[]) => raw.some((r) => "Booking Trpl Id" in r && "Booking Status" in r);

const t = (v: unknown) => (v === null || v === undefined ? "" : String(v).trim());
const yes = (v: unknown) => t(v).toLowerCase() === "yes";

/** Back-office Booking Status -> Bkg FormStatus. Anything with "cancel" in it (Cancel, Client Cancel, Builder Cancel) is Cancel. */
export function formStatusOf(status: unknown): string {
  const s = t(status).toLowerCase().replace(/\s+/g, " ");
  if (s.includes("cancel")) return "Cancel";
  if (s === "not live") return "Not Live";
  if (s === "live") return "Live";
  if (s === "underprocess" || s === "under process" || s === "under-process") return "Not Live";
  return t(status); // unknown: the upload check reports it
}

/** RC/RA status: Cancel wins, then RA = Yes, then RC = Yes, else RC open. */
export function rcRaOf(status: unknown, rc: unknown, ra: unknown): string {
  if (formStatusOf(status) === "Cancel") return "Cancel";
  if (yes(ra)) return "RA Close";
  if (yes(rc)) return "RC Close/RA Open";
  return "RC open";
}

const MAP: [string, string][] = [
  ["Client Name", "Client"], ["Client Co-Applicant", "CoApplicant"], ["Client Remarks", "WorkingRemarks"],
  ["Broker Name", "BrokerName"], ["Broker Amount", "BrokerAmt"],
  ["Project Name", "Project"], ["Unit Number", "UnitNo"], ["Area", "Area"], ["Payment Plan", "PaymentPlan"],
  ["Bsp Sqft", "BSPPSF"], ["Inaugural Discount", "InaugralDiscountPSF"], ["On Form Discount", "OnFormDiscountPSF"], ["Special Discount", "SchemeDiscountPSF"],
  ["Other Charges Per Sqft", "OtherChargesPSF"], ["Gst", "GST"],
];
export const USED_HEADERS = ["Booking Trpl Id", "Booking Status", "Booking Date", "Booking By Name", "Booking By Emp Code", ...MAP.map((m) => m[0]), "RC", "RA"];

export interface Converted { rows: Row[]; rowNo: WeakMap<object, number>; warnings: string[] }

/**
 * employees: the "Name~Code" list of Emp. existingErp: ERPIDs (upper case) already in Bkg.
 * Rows whose ERPID is already in Bkg (or repeated in the file) are left out and reported.
 * The same Project + Unit on a second (third ...) booking that is not cancelled - or already Live / Not Live in Bkg - gets the suffix " Dup2" (" Dup3" ...).
 */
export function convertBackOffice(raw: Row[], employees: string[], existingErp: Map<string, string>, occupied: Set<string>): Converted {
  const byCode = new Map(employees.map((e) => [(e.split("~")[1] ?? "").trim().toUpperCase(), e]));
  const rows: Row[] = [], rowNo = new WeakMap<object, number>(), warnings: string[] = [];
  const skippedBkg: string[] = [], skippedDup: string[] = [], renamed: string[] = [];
  const seenErp = new Set<string>();
  const used = new Set(occupied); // project|unit (lower case) of Live / Not Live bookings in Bkg, then of the bookings read from this file

  raw.forEach((r, i) => {
    if (!Object.values(r).some((v) => t(v) !== "")) return;
    const no = i + 2;
    const erp = t(r["Booking Trpl Id"]);
    if (erp) {
      const u = erp.toUpperCase();
      if (existingErp.has(u)) { skippedBkg.push(`${erp} (${existingErp.get(u)})`); return; }
      if (seenErp.has(u)) { skippedDup.push(erp); return; }
      seenErp.add(u);
    }
    const o: Row = {};
    if (erp) o.ERPID = erp;
    o.FormStatus = formStatusOf(r["Booking Status"]);
    o["RC/RA"] = rcRaOf(r["Booking Status"], r["RC"], r["RA"]);
    o.BkgLoginDate = r["Booking Date"] ?? null;
    const code = t(r["Booking By Emp Code"]).toUpperCase();
    o.Emp = byCode.get(code) ?? (t(r["Booking By Name"]) || code ? `${t(r["Booking By Name"])}~${t(r["Booking By Emp Code"])}` : null);
    for (const [from, to] of MAP) { const v = r[from]; if (t(v) !== "") o[to] = typeof v === "string" ? v.trim() : v; }
    // the same unit sold twice (already in Bkg or earlier in this file): the later booking gets Dup2, Dup3 ... (cancelled bookings may repeat a unit)
    if (o.FormStatus !== "Cancel" && t(o.Project) && t(o.UnitNo)) {
      const proj = t(o.Project).toLowerCase(), was = t(o.UnitNo);
      if (!used.has(`${proj}|${was.toLowerCase()}`)) used.add(`${proj}|${was.toLowerCase()}`);
      else {
        let n = 2;
        while (used.has(`${proj}|${was.toLowerCase()} dup${n}`)) n++;
        o.UnitNo = `${was} Dup${n}`;
        used.add(`${proj}|${was.toLowerCase()} dup${n}`);
        renamed.push(`${erp || `row ${no}`}: ${t(o.Project)} ${was} -> ${o.UnitNo}`);
      }
    }
    rowNo.set(o, no);
    rows.push(o);
  });

  warnings.push(`Back-office sheet recognised - ${rows.length} booking(s) read. Used: Booking Trpl Id (as ERPID), Status, Date, Booked By, Client, Co-Applicant, Remarks, Broker, Project, Unit, Area, Payment Plan, BSP, discounts, Other Charges, GST, RC, RA. Not used: Booking Shared By, Booking Type, Branch (taken from Emp), Team, BBA, KYC, Registry, Welcome Letter, totals and payment columns (receipts come through the Exp upload).`);
  if (skippedBkg.length) warnings.push(`${skippedBkg.length} booking(s) already in Bkg (same ERPID) were left out: ${skippedBkg.slice(0, 20).join(", ")}${skippedBkg.length > 20 ? " ..." : ""}`);
  if (skippedDup.length) warnings.push(`${skippedDup.length} repeated Booking Trpl Id in the file left out (first one kept): ${skippedDup.slice(0, 20).join(", ")}`);
  if (renamed.length) warnings.push(`Same unit booked more than once (not cancelled, or already booked in Bkg) - suffix added to the later one(s): ${renamed.join("; ")}`);
  return { rows, rowNo, warnings };
}
