import { EXP_COLUMNS } from "./calc/exp";

// Column layout shared by the Exp download and the Exp upload template: the template is the download without the columns nobody types.
export const EXP_REMARK_COL = "Data Exception Remarks";
export const EXP_GROUP_COL = "Group";
/** Columns that are typed by hand and read by the upload. */
export const EXP_FILL_COLS = new Set<string>([
  EXP_GROUP_COL, "DocNo", "PayDate", "ValueDate", "Head", "Mode", "Narration", "R/P", "Gross", "GST", "TDS", "Branch", "Emp", "BkgID", "Project",
  "Remarks", "Purpose", "PaymentMode", "Chq/UTR No", "Chq/UTR Date", "Bank Name", "RelatedEmpName", "ExpMonth",
]);
/** Download: remarks and Group first, then the Exp columns. */
export const EXP_DOWNLOAD_COLUMNS: string[] = [EXP_REMARK_COL, EXP_GROUP_COL, ...EXP_COLUMNS];
/** Template: the typed columns, in the order of the download (ExpMonth: blank = from PayDate). */
export const EXP_TEMPLATE_COLUMNS: string[] = EXP_DOWNLOAD_COLUMNS.filter((c) => EXP_FILL_COLS.has(c));

export const FILL_COLOUR = "FFC6EFCE"; // header of a column to fill by hand
export const CALC_COLOUR = "FFD9D9D9"; // header of a built-in (calculated) column
export const CALC_CELL_COLOUR = "FFF2F2F2";
export const REMARK_COLOUR = "FFFFE699";

export const kindOfCol = (c: string): "fill" | "calc" | "remark" => (c === EXP_REMARK_COL ? "remark" : EXP_FILL_COLS.has(c) ? "fill" : "calc");
export const colNote = (c: string): string =>
  c === EXP_REMARK_COL ? "Built in: what is missing or wrong in this entry. Ignored on upload."
  : c === EXP_GROUP_COL ? "Fill by hand. Rows with the same Group label become ONE document. A label that is also on an existing row (or an existing DocNo) adds the new rows to that document."
  : c === "ExpMonth" ? "Optional, yyyy-mm. Blank = built in from PayDate. A month typed here is kept as typed. Type [clear] to go back to the PayDate month."
  : EXP_FILL_COLS.has(c) ? "Fill / correct by hand - read on upload."
  : "Built in (calculated) - ignored on upload even if changed.";
