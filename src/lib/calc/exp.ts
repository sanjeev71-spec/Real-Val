// Calculated columns of the Excel Exp table.
import { codeOf, eq, isoToSerial, num, round, serialToIso, str, type Cell } from "./excel";
import { Hierarchy } from "./hierarchy";

/** Top of the company: when the chain reaches this code, it carries the whole expense as L1 (Excel used TV0022). */
export const TOP_CODE = "200001";

export interface ExpInput {
  docNo: string | null;
  payDate: string | number | null;
  valueDate: string | number | null;
  head: string | null;
  mode: string | null;
  narration?: string | null;
  rp: string | null;
  gross: number | null;
  gst: number | null;
  tds: number | null;
  branch: string | null;
  emp: string | null; // explicit choice; falls back to the booking's Emp
  bkgId: string | null;
  project: string | null; // used when there is no booking
  remarks?: string | null;
}

export interface BookingRef {
  Emp: Cell;
  Client: Cell;
  Project: Cell;
  Builder: Cell;
  FormStatus: Cell;
}

export interface ExpContext {
  hierarchy: Hierarchy;
  /** Director column of each Emp row (same order as hierarchy.rows). */
  empDirectors: string[];
  bookings: Map<string, BookingRef>; // keyed by upper-case BkgID
  /** first booking per project (Rcv_FbBuilder) */
  builderByProject: Map<string, Cell>;
  expTypes: Map<string, string>; // lower-case head -> type
}

export type ExpRow = Record<string, Cell>;

export function computeExp(e: ExpInput, ctx: ExpContext): ExpRow {
  const H = ctx.hierarchy;
  const bk = e.bkgId ? ctx.bookings.get(str(e.bkgId).toUpperCase()) : undefined;
  const emp = str(e.emp) || str(bk?.Emp);
  const pay = isoToSerial(e.payDate as string);
  const d = isoToSerial(e.valueDate as string);
  const expType = ctx.expTypes.get(str(e.head).toLowerCase()) ?? "";
  const gross = num(e.gross);
  const signed = eq(e.rp, "Receipt") ? gross : eq(e.rp, "Payment") ? -gross : 0;
  const g = eq(e.rp, "Payment") ? -Math.abs(gross) : Math.abs(gross);
  const isExpense = eq(expType, "Expense");

  // Director: the Emp row valid on ValueDate
  const c0 = codeOf(emp);
  const ri = d === null ? -1 : H.rowAt(c0, d);
  const director = ri < 0 ? "" : ctx.empDirectors[ri] ?? "";

  // L0 / L1 expense split along the chain, by ExpShare
  let L0 = "", L1 = "", A0 = 0, A1 = 0;
  if (d !== null && c0 !== "") {
    const chain = [c0];
    for (let k = 0; k < 6; k++) chain.push(H.rhAt(chain[chain.length - 1], d));
    const seen = new Set<string>();
    const lst = chain.filter((x) => {
      const k = x.toLowerCase();
      if (x === "" || seen.has(k)) return false;
      seen.add(k);
      return H.expShareAt(x, d) !== 0;
    });
    const c = lst[0] ?? "";
    const nameOf = (x: string) => (x === "" ? "" : H.nameAt(x, d));
    L0 = c === TOP_CODE ? "" : nameOf(c);
    if (c === TOP_CODE) L1 = nameOf(c);
    else if (isExpense && c !== "" && H.expShareAt(c, d) < 1) L1 = nameOf(lst[1] ?? "");
    const share0 = (x: string) => Math.min(1, H.expShareAt(x, d));
    if (L0 !== "") A0 = !isExpense ? g : round(g * share0(codeOf(L0)), 2);
    if (L1 !== "") {
      const l0c = codeOf(L0);
      const l0 = l0c === "" ? 0 : !isExpense ? g : round(g * share0(l0c), 2);
      A1 = round(g - l0, 2);
    }
  }

  const bill = gross + num(e.gst) - num(e.tds);
  const netBill = eq(e.rp, "Receipt") ? bill : eq(e.rp, "Payment") ? -bill : 0;
  return {
    DocNo: e.docNo,
    PayDate: serialToIso(pay),
    ValueDate: serialToIso(d),
    ExpMonth: pay === null ? "" : (serialToIso(pay) ?? "").slice(0, 7),
    ExpType: expType,
    Head: e.head,
    Mode: e.mode,
    Narration: e.narration ?? null,
    "R/P": e.rp,
    Gross: e.gross,
    GST: e.gst,
    TDS: e.tds,
    SignedGross: signed,
    Branch: e.branch,
    Emp: emp,
    BkgID: e.bkgId,
    Client: bk ? bk.Client : null,
    Project: bk ? bk.Project : e.project,
    Director: director,
    Remarks: e.remarks ?? null,
    Rcv_Builder: bk ? bk.Builder : "",
    Rcv_Project: bk ? bk.Project : "",
    Rcv_Status: bk ? bk.FormStatus : "",
    Rcv_FbBuilder: bk ? "" : ctx.builderByProject.get(str(e.project).toLowerCase()) ?? "",
    Rcv_NetBill: netBill,
    L0_Emp: L0,
    L0_Amt: A0,
    L1_Emp: L1,
    L1_Amt: A1,
  };
}

export const EXP_COLUMNS = [
  "DocNo","PayDate","ValueDate","ExpMonth","ExpType","Head","Mode","Narration","R/P","Gross","GST","TDS","SignedGross",
  "Branch","Emp","BkgID","Client","Project","Director","Remarks","Rcv_Builder","Rcv_Project","Rcv_Status","Rcv_FbBuilder",
  "Rcv_NetBill","L0_Emp","L0_Amt","L1_Emp","L1_Amt",
] as const;
