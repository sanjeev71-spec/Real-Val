// Turns text pasted from Excel (tab separated, one transaction line per row) into Exp document lines.
// With a header row the columns are matched by name; without one the default order below is used.

export const PASTE_DEFAULT_ORDER = ["head", "rp", "gross", "gst", "tds", "bkgId", "emp", "narration", "remarks"] as const;

const ALIASES: Record<string, string> = {
  head: "head", "exp head": "head",
  "r/p": "rp", rp: "rp", type: "rp", "receipt/payment": "rp",
  mode: "mode",
  gross: "gross", "gross amt": "gross", "gross amount": "gross", amount: "gross", amt: "gross",
  gst: "gst", tds: "tds",
  bkgid: "bkgId", "bkg id": "bkgId", trplid: "bkgId", "trpl id": "bkgId", realvid: "bkgId", booking: "bkgId",
  employee: "emp", emp: "emp",
  project: "project", narration: "narration", remarks: "remarks", remark: "remarks",
  "pay date": "payDate", paydate: "payDate", date: "payDate", "value date": "valueDate", valuedate: "valueDate",
  branch: "branch",
  purpose: "purpose", paymentmode: "paymentMode", "payment mode": "paymentMode",
  bank: "chqBank", "bank name": "chqBank", bankname: "chqBank",
  "chq / utr no": "instrNo", "chq/utr no": "instrNo", "chq no": "instrNo", "utr no": "instrNo", utr: "instrNo", "instr no": "instrNo",
  "chq / utr date": "instrDate", "chq/utr date": "instrDate", "utr date": "instrDate", "chq date": "instrDate", "instr date": "instrDate",
};

const NUMERIC = new Set(["gross", "gst", "tds"]);
const DATES = new Set(["payDate", "valueDate", "instrDate"]);

export interface PastedLine { [k: string]: string | number | null }
export interface PasteResult { lines: PastedLine[]; warnings: string[]; usedHeader: boolean }

/** dd-mm-yyyy, dd/mm/yyyy, dd.mm.yyyy, yyyy-mm-dd, or an Excel serial number -> yyyy-mm-dd (null when it cannot be read). */
export function parsePasteDate(v: string): string | null {
  const t = v.trim();
  if (!t) return null;
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
  let y: number, mo: number, d: number;
  if (m) { y = +m[1]; mo = +m[2]; d = +m[3]; }
  else if ((m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/.exec(t))) { d = +m[1]; mo = +m[2]; y = +m[3]; if (y < 100) y += 2000; }
  else if (/^\d{5}$/.test(t)) {
    const dt = new Date(Date.UTC(1899, 11, 30) + Number(t) * 86400000);
    return dt.toISOString().slice(0, 10);
  } else return null;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return dt.toISOString().slice(0, 10);
}

function parseRp(v: string): string | null {
  const t = v.trim().toLowerCase();
  if (!t) return null;
  if (t === "r" || t.startsWith("rec")) return "Receipt";
  if (t === "p" || t.startsWith("pay")) return "Payment";
  return null;
}

export function parsePaste(text: string, maxLines = 300): PasteResult {
  const warnings: string[] = [];
  const rows = text.replace(/\r/g, "").split("\n").map((r) => r.split("\t")).filter((r) => r.some((c) => c.trim() !== ""));
  if (!rows.length) return { lines: [], warnings: ["Nothing to paste"], usedHeader: false };

  // a header row is recognised when at least two cells are known column names
  const first = rows[0].map((c) => ALIASES[c.trim().toLowerCase().replace(/\s+/g, " ")]);
  const usedHeader = first.filter(Boolean).length >= 2;
  const cols: (string | undefined)[] = usedHeader ? first : [...PASTE_DEFAULT_ORDER];
  const body = usedHeader ? rows.slice(1) : rows;
  if (body.length > maxLines) warnings.push(`Only the first ${maxLines} lines were taken (${body.length} pasted)`);

  const lines: PastedLine[] = [];
  body.slice(0, maxLines).forEach((r, i) => {
    const line: PastedLine = {};
    const rowNo = i + 1;
    cols.forEach((k, c) => {
      const raw = (r[c] ?? "").trim();
      if (!k || raw === "") return;
      if (NUMERIC.has(k)) {
        const n = Number(raw.replace(/[,₹\s]/g, "").replace(/^\((.*)\)$/, "-$1"));
        if (Number.isFinite(n)) line[k] = n; else warnings.push(`Line ${rowNo}: "${raw}" is not a number for ${k}`);
      } else if (DATES.has(k)) {
        const d = parsePasteDate(raw);
        if (d) line[k] = d; else warnings.push(`Line ${rowNo}: "${raw}" is not a date`);
      } else if (k === "rp") {
        const p = parseRp(raw);
        if (p) line[k] = p; else warnings.push(`Line ${rowNo}: R/P "${raw}" should be Receipt or Payment`);
      } else line[k] = raw;
    });
    // a negative amount is a payment of the positive figure (same rule as the Chq import)
    if (typeof line.gross === "number" && line.gross < 0) { line.gross = -line.gross; if (!line.rp) line.rp = "Payment"; }
    lines.push(line);
  });
  return { lines, warnings: warnings.slice(0, 20), usedHeader };
}
