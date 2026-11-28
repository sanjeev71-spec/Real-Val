// Per-company settings. One codebase serves RealV and TRPL; the deployment picks one with
// NEXT_PUBLIC_COMPANY=realv|trpl (default realv). Safe to import from server and browser code.
export interface Company {
  key: "realv" | "trpl";
  /** App name in the header, page title and e-mails. */
  name: string;
  /** Legal name used in the form undertaking. */
  legalName: string;
  /** Short label of the sale form: SCD or SIF. */
  form: string;
  formLong: string;
  /** BkgID prefix; new IDs continue from the highest existing one. */
  idPrefix: string;
  idDigits: number;
  /** Employee code at the very top of the chain (the fallback Director). */
  topCode: string;
  /** Value stored in Emp.Company for new employees. */
  empCompany: string;
  /** Example ID for hints. */
  idExample: string;
  /** GST charged on the total cost of a new booking (0.12 = 12%). */
  gstRate: number;
  /** true = GST is a typed amount on the booking (blank = 0), not a calculated column. */
  gstManual: boolean;
  defaultPartners: string[];
  /** true = Project, Unit, Builder, Area and the price-list fields are typed on the booking (masters only suggest them). */
  manualMasters: boolean;
  /** true = UnitNo may be blank and the same unit may be on several bookings (no unit checks). */
  freeUnits: boolean;
  /** true = HR may use Upload Emp (sent to Master for approval); false = only Master uploads Emp. */
  hrEmpUpload: boolean;
  /** Seat cost charged per month per seat (0 = not charged yet: the mechanism runs at 0 and reports do not mention seat cost). */
  seatCostPerMonth: number;
}

const COMPANIES: Record<Company["key"], Company> = {
  realv: {
    key: "realv", name: "Realty Vault", legalName: "Realty Vault Pvt. Ltd.", form: "SCD", formLong: "Sale Confirmation Dossier",
    idPrefix: "RV", idDigits: 4, topCode: "200001", empCompany: "RV", idExample: "RV0001", gstRate: 0.12, gstManual: false, manualMasters: false, freeUnits: false, hrEmpUpload: false, seatCostPerMonth: 0,
    defaultPartners: ["Pratham Goyal~100031", "Pawan Bedi~200001", "Tarun Kumar~100030", "Aditya Goel~200002"],
  },
  trpl: {
    key: "trpl", name: "Truevisory Realty", legalName: "Truevisory Realty Pvt. Ltd.", form: "SIF", formLong: "Sales Information Form",
    idPrefix: "TRPL", idDigits: 4, topCode: "TV0022", empCompany: "Truevisory Realty Pvt Ltd", idExample: "TRPL5200", gstRate: 0, gstManual: true, manualMasters: true, freeUnits: true, hrEmpUpload: true, seatCostPerMonth: 5000,
    defaultPartners: ["Aman Jain~TV0022"],
  },
};

const key = (process.env.NEXT_PUBLIC_COMPANY === "trpl" ? "trpl" : "realv") as Company["key"];
export const COMPANY: Company = COMPANIES[key];
export const idPattern = new RegExp(`^${COMPANY.idPrefix}\\d{${COMPANY.idDigits},}$`);

/** Who may use Upload Emp (template, check, upload): Master always; HR only where the company allows it. */
export const canUploadEmp = (role: string | null | undefined) => role === "master" || (role === "hr" && COMPANY.hrEmpUpload);

/** true once seat cost is charged (seatCostPerMonth > 0): only then do the dashboard, P&L and downloads show it. */
export const SEAT_CHARGED = COMPANY.seatCostPerMonth > 0;
