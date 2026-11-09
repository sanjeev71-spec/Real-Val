// Column registry for the Bkg table. Keys are the exact Excel headers.

export const BKG_COLUMNS = [
  "BkgMonth","BkgLoginDate","FormStatus","SourceOfLead","PropertyType","Director","Emp","BkgID","Client","CoApplicant",
  "Address","AreaSectorColony","City","State","PIN","Mobile2","Email","Aadhaar","PAN","Project","Builder","BuilderUID",
  "UnitNo","PaymentPlan","Branch","BBA Status","Area","BSPPSF","InaugralDiscountPSF","NPVDiscountPSF","SchemeDiscountPSF",
  "FormRevisedPSF","AgreementRevisedPSF","PaymentPlanDiscountPSF","OnFormDiscountPSF","NetBSPPSF","PLCPSF","IFMSPSF",
  "PowerBackupPSF","SinkingFundClubPSF","OtherChargesPSF","TotalChargesPSF","TotalCostPSF","TotalCostAmt","GST","TCWithGST",
  "BrokerName","BrokerAmt","CreditNoteAmt","SIFStatus","WorkingRemarks","RAAchievePertenage","ContactNo","ProjectLocation",
  "RC/RA","SPD","ChqAmt","TotalRecdAmt","Recd%","Recoverable","ExpectedCollectionDate","CalcBasis","RA%","SlabRemarks",
  "CSlab","CSlabType","CoRev","UnitAdj","DSlab","DSlabType","DirectorRevenue","ASlab","ASlabType","AssociateRevenue",
  "DirectorSplRevenue","SpinToWin","IncentivePOC","IncentiveRV","IncentiveBuilder","RS_ChainCodes","CoRevRA","FormRevised",
  "RecdFromClient","BuilderDep","CommRecd","RecdNOC","CommBilled","TotRecd","PendDue","FutDue","OverRecd","BillGSTTDS",
  "RecdAgtBill","BillOS","L0_Emp","L0_Share%","L0_Share","L0_SharexRA","L1_Emp","L1_Share%","L1_Share","L1_SharexRA",
  "L2_Emp","L2_Share%","L2_Share","L2_SharexRA","L3_Emp","L3_Share%","L3_Share","L3_SharexRA","L4_Emp","L4_Share%",
  "L4_Share","L4_SharexRA","RS_Depth","Override_Emp","Override_Share%","Override_Share","Override_SharexRA","RS_FormStatusExact",
] as const;

const COMPUTED = new Set<string>([
  "Director","NetBSPPSF","TotalChargesPSF","TotalCostPSF","TotalCostAmt","GST","TCWithGST","SPD","ChqAmt","TotalRecdAmt",
  "Recd%","Recoverable","RA%","CoRev","DirectorRevenue","AssociateRevenue","RS_ChainCodes","CoRevRA","FormRevised",
  "RecdFromClient","BuilderDep","CommRecd","RecdNOC","CommBilled","TotRecd","PendDue","FutDue","OverRecd","BillGSTTDS",
  "RecdAgtBill","BillOS","RS_Depth","Override_Emp","Override_Share%","Override_Share","Override_SharexRA","RS_FormStatusExact",
  ...[0, 1, 2, 3, 4].flatMap((k) => [`L${k}_Emp`, `L${k}_Share%`, `L${k}_Share`, `L${k}_SharexRA`]),
]);

/** Columns a person (or the CSV upload) supplies. Everything else is calculated. */
export const BKG_INPUT_KEYS: string[] = BKG_COLUMNS.filter((c) => !COMPUTED.has(c));

export const DATE_KEYS = new Set(["BkgMonth", "BkgLoginDate", "ExpectedCollectionDate"]);
export const NUMBER_KEYS = new Set([
  "Area","BSPPSF","InaugralDiscountPSF","NPVDiscountPSF","SchemeDiscountPSF","FormRevisedPSF","AgreementRevisedPSF",
  "PaymentPlanDiscountPSF","OnFormDiscountPSF","PLCPSF","IFMSPSF","PowerBackupPSF","SinkingFundClubPSF","OtherChargesPSF",
  "BrokerAmt","CreditNoteAmt","RAAchievePertenage","CSlab","DSlab","ASlab","UnitAdj","DirectorSplRevenue","SpinToWin",
  "IncentivePOC","IncentiveRV","IncentiveBuilder",
]);

export const FORM_STATUSES = ["Not Live", "Live", "Cancel"] as const;
export const SOLD_STATUSES = ["Live", "Not Live"];
export const SOURCES_OF_LEAD = ["Reference", "Company Lead", "Company SMS", "Advertisement", "Walk-In", "Event"];
export const PROPERTY_TYPES = ["Residential", "Retail", "Office Space", "Studio", "Land/Plot", "Cinema Seat"];

/** Defaults agreed for new bookings. */
export const NEW_BOOKING_DEFAULTS: Record<string, string> = {
  FormStatus: "Not Live",
  "RC/RA": "RC open",
  CalcBasis: "TC",
  "BBA Status": "BBA Pending",
};

/** Columns that money/percent formatting applies to on screen. */
export const PERCENT_KEYS = new Set(["Recd%", "RA%", "L0_Share%", "L1_Share%", "L2_Share%", "L3_Share%", "L4_Share%", "Override_Share%"]);

/** Groups for the read-only booking view (SCD Logged). */
export const DISCOUNT_KEYS = ["InaugralDiscountPSF","NPVDiscountPSF","SchemeDiscountPSF","FormRevisedPSF","AgreementRevisedPSF","PaymentPlanDiscountPSF","OnFormDiscountPSF"];

/** Costing block shown in three columns: totals | discounts | charges (as on the SCD sheet). */
export const COSTING_COLUMNS: { key: string; label: string }[][] = [
  [
    { key: "BSPPSF", label: "BSPPSF" }, { key: "Total DiscountPSF", label: "Total DiscountPSF" },
    { key: "NetBSPPSF", label: "NetBSPPSF" }, { key: "TotalChargesPSF", label: "TotalChargesPSF" },
    { key: "TotalCostPSF", label: "TotalCostPSF" }, { key: "TotalCostAmt", label: "TotalCostAmt" },
    { key: "GST", label: "GST" }, { key: "TCWithGST", label: "TCWithGST" },
  ],
  DISCOUNT_KEYS.map((k) => ({ key: k, label: k })),
  [
    { key: "PLCPSF", label: "PLC (PSF)" }, { key: "IFMSPSF", label: "IFMS (PSF)" },
    { key: "PowerBackupPSF", label: "Power Backup (PSF)" }, { key: "SinkingFundClubPSF", label: "Sinking Fund/Club (PSF)" },
    { key: "OtherChargesPSF", label: "Other Charges (PSF)" },
  ],
];

/** C, D and A slabs side by side, each with its type and revenue. */
export const SLAB_COLUMNS: { key: string; label: string }[][] = [
  [{ key: "CSlab", label: "CSlab" }, { key: "CSlabType", label: "CSlabType" }, { key: "CoRev", label: "CoRev" }],
  [{ key: "DSlab", label: "DSlab" }, { key: "DSlabType", label: "DSlabType" }, { key: "DirectorRevenue", label: "DirectorRevenue" }],
  [{ key: "ASlab", label: "ASlab" }, { key: "ASlabType", label: "ASlabType" }, { key: "AssociateRevenue", label: "AssociateRevenue" }],
];

/**
 * Read-only booking view. A section shows `columns` (vertical groups side by side) first, then `keys` in a grid.
 * In `keys`, "" is an empty cell so the three-column grid lines up as on the SCD sheet.
 */
export const VIEW_SECTIONS: { title: string; keys: string[]; columns?: { key: string; label: string }[][] }[] = [
  { title: "Booking", keys: ["BkgID","BkgMonth","BkgLoginDate","FormStatus","SourceOfLead","PropertyType","Emp","Director","Branch","BBA Status","RC/RA","CalcBasis","SIFStatus","WorkingRemarks","ExpectedCollectionDate"] },
  { title: "Client", keys: ["Client","CoApplicant","ContactNo","Mobile2","Email","Address","AreaSectorColony","City","State","PIN","Aadhaar","PAN"] },
  { title: "Project / Unit", keys: ["Project","Builder","ProjectLocation","UnitNo","BuilderUID","","Area","PaymentPlan"] },
  { title: "Costing details", keys: [], columns: COSTING_COLUMNS },
  { title: "Broker details", keys: ["BrokerName","BrokerAmt","CreditNoteAmt"] },
  { title: "Slabs & revenue", columns: SLAB_COLUMNS, keys: ["SlabRemarks","UnitAdj","RA%","CoRevRA","RAAchievePertenage"] },
  { title: "Incentives", keys: ["DirectorSplRevenue","SpinToWin","IncentivePOC","IncentiveRV","IncentiveBuilder"] },
  { title: "Receipts & dues", keys: ["SPD","ChqAmt","TotalRecdAmt","Recd%","Recoverable","FormRevised","RecdFromClient","BuilderDep","CommRecd","RecdNOC","CommBilled","TotRecd","PendDue","FutDue","OverRecd","BillGSTTDS","RecdAgtBill","BillOS"] },
  { title: "Revenue share", keys: ["RS_ChainCodes","RS_Depth",...[0,1,2,3,4].flatMap((k)=>[`L${k}_Emp`,`L${k}_Share%`,`L${k}_Share`,`L${k}_SharexRA`]),"Override_Emp","Override_Share%","Override_Share","Override_SharexRA"] },
];
