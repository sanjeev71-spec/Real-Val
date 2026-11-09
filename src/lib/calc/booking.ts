// Port of every calculated column in the Excel Bkg table.
import { codeOf, eq, isoToSerial, N, num, round, str, type Cell } from "./excel";
import { Hierarchy, overrideAt, type OverrideRule } from "./hierarchy";

export const GST_RATE = 0.12;

/** One Exp (receipt/payment) row — only the fields Bkg reads. */
export interface ExpRow {
  bkgId: string | null;
  project: string | null;
  head: string | null;
  mode: string | null;
  rp: string | null; // "Receipt" | "Payment"
  gross: number | null;
  gst: number | null;
  tds: number | null;
}

export interface RcRa {
  rcra: string;
  ra: number | null;
}

export interface CalcContext {
  hierarchy: Hierarchy;
  exp: ExpRow[];
  rcra: RcRa[];
  overrides: OverrideRule[];
  /** All BkgIDs in the table (for the OA "unlinked money" rule). */
  allBkgIds: string[];
}

/** Input columns, keyed exactly as the Excel Bkg headers. */
export type BookingInput = Record<string, Cell>;
export type BookingRow = Record<string, Cell>;

const signed = (e: ExpRow) => (eq(e.rp, "Receipt") ? num(e.gross) : eq(e.rp, "Payment") ? -num(e.gross) : 0);
const netBill = (e: ExpRow) => signed(e) + num(e.gst) - num(e.tds);

/** The eight slab types shared by CoRev, DirectorRevenue and AssociateRevenue. */
export function slabValue(
  p: { A: number; b: number; ig: number; NP: number; Sc: number; fr: number; AR: number; of: number; TC: number },
  slab: Cell,
  slabType: Cell,
): number | "" {
  const sl = round(N(slab), 6);
  if (typeof slabType === "number") return slabType;
  const { A, b, ig, NP, Sc, fr, AR, of, TC } = p;
  if (A === 0 || b === 0 || TC === 0 || sl === 0) return 0;
  switch (str(slabType).toUpperCase()) {
    case "PSF": return A * (sl - of);
    case "%BSP": return A * ((b - ig - fr) * sl - of + fr + AR);
    case "%TC": return A * (TC + NP + Sc + fr + AR + of) * sl - A * of;
    case "FIX": return sl - A * of;
    case "TLC": return A * (TC + NP + Sc + fr + AR) - sl;
    case "LPSF": return A * (TC + NP + Sc + fr + AR - sl);
    case "LPSFB": return A * (b - ig - of - sl);
    default: return "";
  }
}

const EXCLUDED_STATUSES = ["OA", "Cancel", "IC Bkg"];

/** Compute a full Bkg row (all 120 columns) from its input columns. */
export function computeBooking(input: BookingInput, ctx: CalcContext): BookingRow {
  const r: BookingRow = { ...input };
  const H = ctx.hierarchy;
  const id = str(input.BkgID);
  const project = str(input.Project);
  const status = str(input.FormStatus);
  const bkgMonth = isoToSerial(input.BkgMonth);
  const login = isoToSerial(input.BkgLoginDate);
  const m = bkgMonth ?? 0;

  // ---- cost build-up
  const v = (k: string) => num(input[k]);
  const Area = v("Area");
  const netBsp =
    v("BSPPSF") - v("InaugralDiscountPSF") - v("NPVDiscountPSF") - v("SchemeDiscountPSF") -
    v("FormRevisedPSF") - v("AgreementRevisedPSF") - v("PaymentPlanDiscountPSF") - v("OnFormDiscountPSF");
  const totalCharges = v("PLCPSF") + v("IFMSPSF") + v("PowerBackupPSF") + v("SinkingFundClubPSF") + v("OtherChargesPSF");
  const tcPsf = netBsp + totalCharges;
  const tcAmt = Area * tcPsf;
  const gst = tcAmt * GST_RATE;
  Object.assign(r, {
    NetBSPPSF: netBsp,
    TotalChargesPSF: totalCharges,
    TotalCostPSF: tcPsf,
    TotalCostAmt: tcAmt,
    GST: gst,
    TCWithGST: tcAmt + gst,
  });

  // ---- director
  const empCode = codeOf(input.Emp);
  const dirDate = login ?? bkgMonth;
  try {
    r.Director = empCode === "" ? "No Match" : dirDate === null ? "" : H.directorNameAt(empCode, dirDate);
  } catch {
    r.Director = "#VALUE!";
  }

  // ---- money from Exp
  const exp = ctx.exp;
  const isOA = eq(status, "OA");
  const valid = new Set(ctx.allBkgIds.filter((x) => x !== "").map((x) => x.toLowerCase()));
  const sumHeads = (heads: string[], modeFilter: (e: ExpRow) => boolean) => {
    let amt = 0;
    if (id !== "") {
      for (const e of exp) if (eq(e.bkgId, id) && heads.some((h) => eq(e.head, h)) && modeFilter(e)) amt += signed(e);
    } else if (isOA) {
      for (const e of exp)
        if (eq(e.project, project) && heads.some((h) => eq(e.head, h)) && modeFilter(e) && !valid.has(str(e.bkgId).toLowerCase()))
          amt += signed(e);
    }
    return round(amt, 0);
  };
  const notChq = (e: ExpRow) => !eq(e.mode, "Chq");
  const any = () => true;
  const spd = sumHeads(["Recd From Client", "Form Revised"], notChq);
  let chq = 0;
  if (id !== "") for (const e of exp) if (eq(e.bkgId, id) && eq(e.mode, "Chq") && eq(e.head, "Recd From Client")) chq += signed(e);
  const totalRecd = spd + chq;
  const brokerageBy = (f: (e: ExpRow) => boolean, val: (e: ExpRow) => number = signed) => {
    let s = 0;
    for (const e of exp) if (eq(e.bkgId, id) && eq(e.project, project) && f(e)) s += val(e);
    return s;
  };
  const isBrk = (e: ExpRow) => eq(e.head, "Brokerage Recd");
  const commRecd = brokerageBy((e) => isBrk(e) && !eq(e.mode, "Billing") && !eq(e.mode, "NOC"));
  const recdNoc = brokerageBy((e) => isBrk(e) && eq(e.mode, "NOC"));
  const commBilled = brokerageBy((e) => isBrk(e) && eq(e.mode, "Billing"));
  const billGstTds = brokerageBy((e) => isBrk(e) && eq(e.mode, "Billing"), netBill);
  const recdAgtBill = brokerageBy((e) => eq(e.head, "Billed and Recd"), netBill);
  const formRevised = sumHeads(["Form Revised"], any);
  const recdFromClient = sumHeads(["Recd From Client"], notChq);
  const builderDep = sumHeads(["Builder Deposit", "Cost Adjusted"], any);

  const NP = v("NPVDiscountPSF"), Sc = v("SchemeDiscountPSF"), fr = v("FormRevisedPSF"), AR = v("AgreementRevisedPSF");
  const den = Area * ((eq(input.CalcBasis, "BSP") ? netBsp : tcPsf) + NP + Sc + fr + AR);
  const excluded = EXCLUDED_STATUSES.some((s) => eq(s, status));
  Object.assign(r, {
    SPD: spd,
    ChqAmt: chq,
    TotalRecdAmt: totalRecd,
    "Recd%": den === 0 ? 0 : (totalRecd + Area * (NP + Sc)) / den,
    Recoverable: excluded ? 0 : tcAmt + Area * fr - totalRecd,
  });

  // ---- RA%
  const ra = ctx.rcra.find((x) => eq(x.rcra, input["RC/RA"]));
  const raPct = ra ? num(ra.ra) : 0;
  r["RA%"] = raPct;

  // ---- revenue by slab
  const p = { A: Area, b: v("BSPPSF"), ig: v("InaugralDiscountPSF"), NP, Sc, fr, AR, of: v("OnFormDiscountPSF"), TC: tcPsf };
  const br = N(num(input.BrokerAmt)), cn = N(num(input.CreditNoteAmt));
  const co = slabValue(p, num(input.CSlab), input.CSlabType);
  const coRev: number | "" = co === "" ? "" : round(co, 0);
  const dv = slabValue(p, num(input.DSlab), input.DSlabType);
  const dirRev: number | "" = dv === "" ? "" : round(dv - br - cn, 0);
  const av = slabValue(p, num(input.ASlab), input.ASlabType);
  const assocRev: number | "" = av === "" ? "" : round(av - br - cn, 0);
  r.CoRev = coRev;
  r.DirectorRevenue = dirRev;
  r.AssociateRevenue = assocRev;

  const unitAdj = v("UnitAdj");
  const coRevRA = coRev === "" ? 0 : (coRev - Area * fr - unitAdj) * raPct;
  const totRecd = recdFromClient + builderDep + commRecd + recdNoc + commBilled;
  const cancelled = eq(status, "Cancel") || eq(status, "IC Bkg");
  Object.assign(r, {
    CoRevRA: coRevRA,
    FormRevised: formRevised,
    RecdFromClient: recdFromClient,
    BuilderDep: builderDep,
    CommRecd: commRecd,
    RecdNOC: recdNoc,
    CommBilled: commBilled,
    TotRecd: totRecd,
    PendDue: cancelled ? 0 : Math.max(0, coRevRA - totRecd),
    FutDue: cancelled ? 0 : coRev === "" ? "#VALUE!" : coRev - Area * fr - unitAdj - coRevRA,
    OverRecd: Math.min(0, coRevRA - totRecd),
    BillGSTTDS: billGstTds,
    RecdAgtBill: recdAgtBill,
    BillOS: billGstTds - recdAgtBill,
  });

  // ---- revenue-share waterfall
  const chain = bkgMonth === null ? "" : H.chainCodes(empCode, m);
  r.RS_ChainCodes = chain;
  const list = bkgMonth === null ? [] : H.shareList(empCode, m, chain);
  const depth = Math.min(5, list.length);
  r.RS_Depth = depth;

  const levelEmp = (offset: number) => {
    const n = depth - offset;
    if (n < 1) return "";
    const c = list[n - 1] ?? "";
    return c === "" ? "" : H.nameAt(c, m);
  };
  const pct = (e: string) => {
    const c = codeOf(e);
    return c === "" ? 0 : H.revShareAt(c, m);
  };
  const L = [4, 3, 2, 1, 0].map(levelEmp); // L0..L4
  const P = L.map(pct);
  const share = (k: number, x: () => number) => (L[k] === "" || id === "" ? 0 : x());
  const S: number[] = [];
  S[0] = share(0, () => round(N(assocRev) * P[0], 0));
  S[1] = share(1, () => round(N(assocRev) * P[1] - S[0], 0));
  S[2] = share(2, () => round(N(assocRev) * P[2] - (S[0] + S[1]), 0));
  S[3] = share(3, () =>
    round(
      N(dirRev) * P[3] +
        (depth > 1 ? v("DirectorSplRevenue") + v("SpinToWin") + v("IncentiveRV") : 0) -
        (S[0] + S[1] + S[2]),
      0,
    ),
  );

  // ---- override (Branch and Director are the intended inputs; the Excel formula had #REF! here)
  const ovEmp = bkgMonth === null ? "" : overrideAt(ctx.overrides, input.Branch, r.Director, m, input.Emp, chain);
  const ovRule = ctx.overrides.find((o) => eq(o.overrideEmployee, ovEmp));
  const ovPct = ovEmp === "" ? 0 : num(ovRule?.sharePct ?? 0);
  const ovShare = ovEmp === "" ? 0 : round(N(dirRev) * ovPct, 0);

  S[4] = share(4, () =>
    round(
      (N(coRev) - br - cn) * P[4] +
        (depth === 1 ? v("SpinToWin") + v("IncentivePOC") + v("IncentiveBuilder") : 0) -
        (S[0] + S[1] + S[2] + S[3]),
      0,
    ) - ovShare,
  );

  for (let k = 0; k <= 4; k++) {
    r[`L${k}_Emp`] = L[k];
    r[`L${k}_Share%`] = P[k];
    r[`L${k}_Share`] = S[k];
    r[`L${k}_SharexRA`] = round(S[k] * raPct, 0);
  }
  r.Override_Emp = ovEmp;
  r["Override_Share%"] = ovPct;
  r.Override_Share = ovShare;
  r.Override_SharexRA = round(ovShare * raPct, 0);
  r.RS_FormStatusExact = status === "cancel" ? "Show" : "";
  return r;
}

export function computeAll(inputs: BookingInput[], ctx: Omit<CalcContext, "allBkgIds">): BookingRow[] {
  const full: CalcContext = { ...ctx, allBkgIds: inputs.map((i) => str(i.BkgID)) };
  return inputs.map((i) => computeBooking(i, full));
}
