// Port of the Excel "DemandAll" sheet: demand schedule and outstanding per booking.
import { isoToSerial, N, num, str, type Cell } from "./excel";

export const FIRST_DEMAND_DAYS = 45;
export const GST_FACTOR = 1.12;

export type DemandStatus = "due" | "cleared" | "nocost";

export interface DemandRow {
  BkgID: string;
  Director: string;
  Builder: string;
  Project: string;
  Client: string;
  UnitNo: string;
  BrokerName: string;
  FormStatus: string;
  BkgLoginDate: number | null; // serial
  Area: number;
  BSPPSF: number;
  AgreementRevisedPSF: number;
  OtherChargesPSF: number;
  TotalCostPSF: number;
  TotalCostAmt: number;
  GST: number;
  EffTotalCostAmt: number;
  EffTCWithGST: number;
  ChqAmt: number;
  FirstDueDate: number | null;
  FirstDemandAmt: number;
  NetRecdExGST: number;
  FirstAROffset: number;
  FirstNetDemand: number;
  FirstNetDemandGST: number;
  DelayDays: number;
  BBAStatus: string;
  SPD: number;
  SecondDueDate: number | null;
  SecondDemandAmt: number;
  SecondAROffset: number;
  SecondNetDemand: number;
  ThirdDueDate: number | null;
  ThirdDemandAmt: number;
  ThirdNetDemand: number;
  TotalOutstanding: number;
  status: DemandStatus;
}

/** Name part of "Name~Code". */
const nameOnly = (x: Cell) => {
  const s = str(x);
  const i = s.indexOf("~");
  return i < 0 ? s : s.slice(0, i);
};

export function computeDemand(
  b: Record<string, Cell>,
  opts: { today: number; structureDate: number | null; possessionDate: number | null },
): DemandRow {
  const F = num(b.Area), H = num(b.AgreementRevisedPSF), K = N(b.TotalCostAmt as number), L = N(b.GST as number);
  const M = K + H * F;
  const O = N(b.ChqAmt as number);
  const E = isoToSerial(b.BkgLoginDate as string);
  const P = E === null ? null : E + FIRST_DEMAND_DAYS;
  const Q = M * 0.4;
  const R = O / GST_FACTOR;
  const S = M === 0 ? 0 : Math.min(Q - R, H * F);
  const T = M === 0 ? 0 : Q - R - S;
  const Z = M * 0.3;
  const AA = H * F - S;
  const AB = Z - AA;
  const AD = M * 0.3;
  const AF = T + AB + AD;
  return {
    BkgID: str(b.BkgID),
    Director: nameOnly(b.Director),
    Builder: str(b.Builder),
    Project: str(b.Project),
    Client: str(b.Client),
    UnitNo: str(b.UnitNo),
    BrokerName: str(b.BrokerName),
    FormStatus: str(b.FormStatus),
    BkgLoginDate: E,
    Area: F,
    BSPPSF: num(b.BSPPSF),
    AgreementRevisedPSF: H,
    OtherChargesPSF: num(b.OtherChargesPSF),
    TotalCostPSF: N(b.TotalCostPSF as number),
    TotalCostAmt: K,
    GST: L,
    EffTotalCostAmt: M,
    EffTCWithGST: M + L,
    ChqAmt: O,
    FirstDueDate: P,
    FirstDemandAmt: Q,
    NetRecdExGST: R,
    FirstAROffset: S,
    FirstNetDemand: T,
    FirstNetDemandGST: T * GST_FACTOR,
    DelayDays: T > 0 && P !== null ? Math.max(0, opts.today - P) : 0,
    BBAStatus: str(b["BBA Status"]),
    SPD: F * H, // the sheet's "SPD" column is Area × AgreementRevisedPSF
    SecondDueDate: opts.structureDate,
    SecondDemandAmt: Z,
    SecondAROffset: AA,
    SecondNetDemand: AB,
    ThirdDueDate: opts.possessionDate,
    ThirdDemandAmt: AD,
    ThirdNetDemand: AD,
    TotalOutstanding: AF,
    status: M === 0 ? "nocost" : T > 0.005 ? "due" : "cleared",
  };
}

/** Columns in display order: [key, header, kind]. */
export const DEMAND_COLUMNS: [keyof DemandRow, string, "text" | "date" | "num" | "int"][] = [
  ["Director", "Director", "text"],
  ["Builder", "Builder", "text"],
  ["Project", "Project", "text"],
  ["Client", "Client", "text"],
  ["UnitNo", "UnitNo", "text"],
  ["BkgID", "BkgID", "text"],
  ["BrokerName", "BrokerName", "text"],
  ["BkgLoginDate", "BkgLoginDate", "date"],
  ["Area", "Area", "num"],
  ["BSPPSF", "BSPPSF", "num"],
  ["AgreementRevisedPSF", "AgreementRevisedPSF", "num"],
  ["OtherChargesPSF", "OtherChargesPSF", "num"],
  ["TotalCostPSF", "TotalCostPSF", "num"],
  ["TotalCostAmt", "TotalCostAmt", "num"],
  ["GST", "GST", "num"],
  ["EffTotalCostAmt", "Effective TotalCostAmt", "num"],
  ["EffTCWithGST", "Effective TCWithGST", "num"],
  ["ChqAmt", "ChqAmt Recd", "num"],
  ["FirstDueDate", "1st Demand Due Date", "date"],
  ["FirstDemandAmt", "1st Demand Amt (40%)", "num"],
  ["NetRecdExGST", "Net Recd (excl GST)", "num"],
  ["FirstAROffset", "1st AgreementRevised Offset", "num"],
  ["FirstNetDemand", "1st Net Demand", "num"],
  ["FirstNetDemandGST", "1st Net Demand Including GST", "num"],
  ["DelayDays", "Delay Days (1st Demand)", "int"],
  ["BBAStatus", "BBA Status", "text"],
  ["SPD", "SPD", "num"],
  ["SecondDueDate", "2nd Demand Due Date", "date"],
  ["SecondDemandAmt", "2nd Demand Amt (30%)", "num"],
  ["SecondAROffset", "2nd AgreementRevised Offset", "num"],
  ["SecondNetDemand", "2nd Net Demand", "num"],
  ["ThirdDueDate", "3rd Demand Due Date", "date"],
  ["ThirdDemandAmt", "3rd Demand Amt (30%)", "num"],
  ["ThirdNetDemand", "3rd Net Demand", "num"],
  ["TotalOutstanding", "Total Net Demand Outstanding", "num"],
];
