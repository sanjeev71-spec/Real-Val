// Data exceptions: records that look incomplete or inconsistent, found from the calculated Bkg and Exp.
type Row = Record<string, unknown>;
const t = (v: unknown) => String(v ?? "").trim();
const n = (v: unknown) => (typeof v === "number" ? v : Number(v) || 0);
const SOLD = new Set(["live", "not live"]);

export interface ExceptionItem { ref: string; href: string; detail: string }
export interface ExceptionGroup {
  key: string; title: string; why: string; severity: "high" | "medium" | "low"; count: number; items: ExceptionItem[]; // items = first 100
}

const MAX_ITEMS = 100;

export function findExceptions(bk: Row[], exps: (Row & { id?: number })[], empNames: Set<string>, heads: Set<string>): ExceptionGroup[] {
  const groups: ExceptionGroup[] = [];
  const add = (key: string, title: string, why: string, severity: ExceptionGroup["severity"], hits: ExceptionItem[]) => {
    if (hits.length) groups.push({ key, title, why, severity, count: hits.length, items: hits.slice(0, MAX_ITEMS) });
  };

  const bkIds = new Set(bk.map((b) => t(b.BkgID).toUpperCase()).filter(Boolean));
  const expLink = (e: Row & { id?: number }) => `/exp/${e.id}`;
  const expRef = (e: Row) => t(e.DocNo) || "(no document number)";
  const expInfo = (e: Row) => `${t(e["R/P"])} ₹${n(e.Gross).toLocaleString("en-IN")} · ${t(e.PayDate)} · ${t(e.Narration).slice(0, 60)}`;

  // ---- Exp
  add("exp-no-head", "Exp lines with no Head", "Without a head the line cannot be classed as income, expense or collection.", "high",
    exps.filter((e) => !t(e.Head)).map((e) => ({ ref: expRef(e), href: expLink(e), detail: expInfo(e) })));
  add("exp-unknown-head", "Exp lines whose Head is not in the Head master", "The line's type (Expense / Income) is blank, so it is left out of the P&L.", "high",
    exps.filter((e) => t(e.Head) && !heads.has(t(e.Head).toLowerCase())).map((e) => ({ ref: expRef(e), href: expLink(e), detail: `${t(e.Head)} · ${expInfo(e)}` })));
  add("exp-bkg-missing", "Exp lines pointing to a BkgID that does not exist", "The amount is not reaching any booking, so receivables are wrong.", "high",
    exps.filter((e) => t(e.BkgID) && !bkIds.has(t(e.BkgID).toUpperCase())).map((e) => ({ ref: expRef(e), href: expLink(e), detail: `${t(e.BkgID)} · ${expInfo(e)}` })));
  add("exp-collection-no-bkg", "Collections (Recd From Client) with no BkgID", "A client receipt that is not linked to a booking is not counted against its bill.", "high",
    exps.filter((e) => t(e.Head).toLowerCase() === "recd from client" && !t(e.BkgID)).map((e) => ({ ref: expRef(e), href: expLink(e), detail: expInfo(e) })));
  add("exp-no-date", "Exp lines with no Pay date", "They fall outside every month and every report.", "high",
    exps.filter((e) => !t(e.PayDate)).map((e) => ({ ref: expRef(e), href: expLink(e), detail: expInfo(e) })));
  add("exp-no-amount", "Exp lines with a zero or blank amount", "Usually an entry that was never completed.", "medium",
    exps.filter((e) => !n(e.Gross)).map((e) => ({ ref: expRef(e), href: expLink(e), detail: `${t(e.Head)} · ${t(e.PayDate)}` })));
  add("exp-no-mode", "Exp lines with no Mode", "Needed to tell cash, cheque and bank entries apart.", "medium",
    exps.filter((e) => !t(e.Mode)).map((e) => ({ ref: expRef(e), href: expLink(e), detail: expInfo(e) })));
  add("exp-expense-no-director", "Expenses with no Director", "The expense cannot be placed in a Director's P&L.", "medium",
    exps.filter((e) => t(e.ExpType) === "Expense" && !t(e.Director)).map((e) => ({ ref: expRef(e), href: expLink(e), detail: `${t(e.Emp) || "no employee"} · ${expInfo(e)}` })));
  add("exp-emp-unknown", "Exp lines whose Employee is not in Emp", "The Director and the expense split cannot be worked out.", "medium",
    exps.filter((e) => t(e.Emp) && !empNames.has(t(e.Emp))).map((e) => ({ ref: expRef(e), href: expLink(e), detail: `${t(e.Emp)} · ${expInfo(e)}` })));
  add("chq-missing", "Cheque / UTR lines missing their instrument details", "A Chq line should carry the Chq / UTR number, its date and the bank.", "medium",
    exps.filter((e) => t(e.Mode).toLowerCase() === "chq" && (!t(e["Chq/UTR No"]) || !t(e["Chq/UTR Date"]) || !t(e["Bank Name"])))
      .map((e) => ({ ref: expRef(e), href: expLink(e), detail: `No ${t(e["Chq/UTR No"]) || "—"} · Date ${t(e["Chq/UTR Date"]) || "—"} · Bank ${t(e["Bank Name"]) || "—"}` })));

  // the same cheque / UTR number, date, amount and direction in two different documents
  const seen = new Map<string, Row & { id?: number }>();
  const dup: ExceptionItem[] = [];
  for (const e of exps) {
    if (!t(e["Chq/UTR No"]) || !t(e["Chq/UTR Date"]) || !t(e.BkgID)) continue; // one UTR paid across several bookings is normal
    const doc = t(e.DocNo).replace(/-\d{1,3}[A-Z]?$/, "");
    const k = [t(e.BkgID).toUpperCase(), t(e["Chq/UTR No"]).toLowerCase(), t(e["Chq/UTR Date"]), n(e.Gross), t(e["R/P"])].join("|");
    const o = seen.get(k);
    if (o && t(o.DocNo).replace(/-\d{1,3}[A-Z]?$/, "") !== doc) dup.push({ ref: expRef(e), href: expLink(e), detail: `same as ${t(o.DocNo)} · ${t(e["Chq/UTR No"])} · ₹${n(e.Gross).toLocaleString("en-IN")}` });
    else if (!o) seen.set(k, e);
  }
  add("chq-duplicate", "Possible duplicate cheque / UTR entries", "The same instrument number, date and amount is booked twice against the same booking, in two different documents.", "high", dup);

  // ---- Bkg
  const live = bk.filter((b) => SOLD.has(t(b.FormStatus).toLowerCase()));
  const bkRef = (b: Row) => ({ ref: t(b.BkgID), href: `/bookings/${encodeURIComponent(t(b.BkgID))}` });
  add("bkg-no-revenue", "Live bookings with no DirectorRevenue", "No slab matched the booking, so its revenue is zero in every report. Check the project's price list / slab.", "high",
    live.filter((b) => !n(b.DirectorRevenue)).map((b) => ({ ...bkRef(b), detail: `${t(b.Project)} · ${t(b.Client)} · ${t(b.BkgMonth)}` })));
  add("bkg-no-director", "Live bookings with no Director", "The booking is not in any Director's P&L.", "high",
    live.filter((b) => !t(b.Director) || t(b.Director) === "No Match" || t(b.Director).startsWith("#")).map((b) => ({ ...bkRef(b), detail: `${t(b.Emp) || "no employee"} · ${t(b.Project)} · ${t(b.BkgMonth)}` })));
  add("bkg-emp-unknown", "Live bookings whose Employee is not in Emp", "The hierarchy, overrides and Director cannot be worked out.", "high",
    live.filter((b) => t(b.Emp) && !empNames.has(t(b.Emp))).map((b) => ({ ...bkRef(b), detail: `${t(b.Emp)} · ${t(b.Project)}` })));
  add("bkg-no-builder", "Live bookings with no Builder", "Receivables from the builder cannot be traced.", "medium",
    live.filter((b) => !t(b.Builder)).map((b) => ({ ...bkRef(b), detail: `${t(b.Project)} · ${t(b.Client)}` })));
  add("bkg-no-month", "Live bookings with no booking month", "They fall outside every month on the dashboard and P&L.", "medium",
    live.filter((b) => !t(b.BkgMonth)).map((b) => ({ ...bkRef(b), detail: `${t(b.Project)} · ${t(b.Client)}` })));

  const order = { high: 0, medium: 1, low: 2 };
  return groups.sort((a, b) => order[a.severity] - order[b.severity] || b.count - a.count);
}
