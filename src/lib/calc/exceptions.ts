// Data exceptions: records that look incomplete or inconsistent, found from the calculated Bkg and Exp.
// Each check returns the real Bkg / Exp rows, so the page and the download show them exactly like the Bkg and Exp pages.
import { sortBkgByDate } from "../bkgFilter";
type Row = Record<string, unknown>;
const t = (v: unknown) => String(v ?? "").trim();
const n = (v: unknown) => (typeof v === "number" ? v : Number(v) || 0);
const SOLD = new Set(["live", "not live"]);

export interface ExceptionGroup {
  key: string; title: string; why: string; severity: "high" | "medium" | "low";
  kind: "exp" | "bkg"; // which table the rows belong to
  count: number; rows: Row[]; // every matching row; the page shows the first ones, the download has all
}

const baseDoc = (docNo: unknown) => t(docNo).replace(/-\d{1,3}[A-Z]?$/, "");

export function findExceptions(bk: Row[], exps: (Row & { id?: number })[], empNames: Set<string>, heads: Set<string>): ExceptionGroup[] {
  const groups: ExceptionGroup[] = [];
  const add = (key: string, title: string, why: string, severity: ExceptionGroup["severity"], kind: "exp" | "bkg", rows: Row[]) => {
    if (rows.length) groups.push({ key, title, why, severity, kind, count: rows.length, rows });
  };
  const bkIds = new Set(bk.map((b) => t(b.BkgID).toUpperCase()).filter(Boolean));

  // ---- Exp
  add("exp-no-head", "Exp lines with no Head", "Without a head the line cannot be classed as income, expense or collection.", "high", "exp",
    exps.filter((e) => !t(e.Head)));
  add("exp-unknown-head", "Exp lines whose Head is not in the Head master", "The line's type (Expense / Income) is blank, so it is left out of the P&L.", "high", "exp",
    exps.filter((e) => t(e.Head) && !heads.has(t(e.Head).toLowerCase())));
  add("exp-bkg-missing", "Exp lines pointing to a BkgID that does not exist", "The amount is not reaching any booking, so receivables are wrong.", "high", "exp",
    exps.filter((e) => t(e.BkgID) && !bkIds.has(t(e.BkgID).toUpperCase())));
  add("exp-collection-no-bkg", "Collections (Recd From Client) with no BkgID", "A client receipt that is not linked to a booking is not counted against its bill.", "high", "exp",
    exps.filter((e) => t(e.Head).toLowerCase() === "recd from client" && !t(e.BkgID)));
  add("exp-no-date", "Exp lines with no Pay date", "They fall outside every month and every report.", "high", "exp",
    exps.filter((e) => !t(e.PayDate)));
  add("exp-no-amount", "Exp lines with a zero or blank amount", "Usually an entry that was never completed.", "medium", "exp",
    exps.filter((e) => !n(e.Gross)));
  add("exp-no-mode", "Exp lines with no Mode", "Needed to tell cash, cheque and bank entries apart.", "medium", "exp",
    exps.filter((e) => !t(e.Mode)));
  add("exp-expense-no-director", "Expenses with no Director", "The expense cannot be placed in a Director's P&L.", "medium", "exp",
    exps.filter((e) => t(e.ExpType) === "Expense" && !t(e.Director)));
  add("exp-emp-unknown", "Exp lines whose Employee is not in Emp", "The Director and the expense split cannot be worked out.", "medium", "exp",
    exps.filter((e) => t(e.Emp) && !empNames.has(t(e.Emp))));
  add("chq-missing", "Cheque / UTR lines missing their instrument details", "A Chq line should carry the Chq / UTR number, its date and the bank.", "medium", "exp",
    exps.filter((e) => t(e.Mode).toLowerCase() === "chq" && (!t(e["Chq/UTR No"]) || !t(e["Chq/UTR Date"]) || !t(e["Bank Name"]))));

  // the same cheque / UTR number, date, amount and direction booked twice against the same booking, in two different documents
  const seen = new Map<string, Row>();
  const dup: Row[] = [];
  for (const e of exps) {
    if (!t(e["Chq/UTR No"]) || !t(e["Chq/UTR Date"]) || !t(e.BkgID)) continue; // one UTR paid across several bookings is normal
    const k = [t(e.BkgID).toUpperCase(), t(e["Chq/UTR No"]).toLowerCase(), t(e["Chq/UTR Date"]), n(e.Gross), t(e["R/P"])].join("|");
    const o = seen.get(k);
    if (o && baseDoc(o.DocNo) !== baseDoc(e.DocNo)) dup.push(e);
    else if (!o) seen.set(k, e);
  }
  add("chq-duplicate", "Possible duplicate cheque / UTR entries", "The same instrument number, date and amount is booked twice against the same booking, in two different documents.", "high", "exp", dup);

  // ---- Bkg
  const live = bk.filter((b) => SOLD.has(t(b.FormStatus).toLowerCase()));
  add("bkg-no-revenue", "Live bookings with no DirectorRevenue", "No slab matched the booking, so its revenue is zero in every report. Check the project's price list / slab.", "high", "bkg",
    live.filter((b) => !n(b.DirectorRevenue)));
  add("bkg-no-director", "Live bookings with no Director", "The booking is not in any Director's P&L.", "high", "bkg",
    live.filter((b) => !t(b.Director) || t(b.Director) === "No Match" || t(b.Director).startsWith("#")));
  add("bkg-emp-unknown", "Live bookings whose Employee is not in Emp", "The hierarchy, overrides and Director cannot be worked out.", "high", "bkg",
    live.filter((b) => t(b.Emp) && !empNames.has(t(b.Emp))));
  add("bkg-no-builder", "Live bookings with no Builder", "Receivables from the builder cannot be traced.", "medium", "bkg",
    live.filter((b) => !t(b.Builder)));
  add("bkg-no-month", "Live bookings with no booking month", "They fall outside every month on the dashboard and P&L.", "medium", "bkg",
    live.filter((b) => !t(b.BkgMonth)));

  for (const g of groups) if (g.kind === "bkg") g.rows = sortBkgByDate(g.rows, "desc");
  const order = { high: 0, medium: 1, low: 2 };
  return groups.sort((a, b) => order[a.severity] - order[b.severity] || b.count - a.count);
}
