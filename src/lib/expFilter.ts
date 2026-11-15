// Filters of the Exp list (used by the page and by the Excel download, so both show the same rows).
export const EXP_TEXT_FILTERS: [key: string, label: string][] = [
  ["doc", "Document number"], ["director", "Director"], ["emp", "Employee"], ["bkg", "BkgID"], ["client", "Client"], ["project", "Project"], ["narration", "Narration"],
];
export const EXP_FILTER_KEYS = ["head", "mode", "rp", "gross", "from", "to", ...EXP_TEXT_FILTERS.map(([k]) => k)];

type Row = Record<string, unknown>;
const text = (v: unknown) => String(v ?? "").toLowerCase();
const nameOnly = (v: unknown) => text(v).split("~")[0];

/** "1000" exact, ">1000", ">=1000", "<5000", "1000-5000" (a range). Returns a test, or null when the text is not a number expression. */
export function grossTest(expr: string): ((v: number) => boolean) | null {
  const s = expr.replace(/[,\s₹]/g, "");
  if (!s) return null;
  let m = /^(>=|<=|>|<)(\d+(?:\.\d+)?)$/.exec(s);
  if (m) {
    const n = Number(m[2]);
    return m[1] === ">" ? (v) => v > n : m[1] === ">=" ? (v) => v >= n : m[1] === "<" ? (v) => v < n : (v) => v <= n;
  }
  m = /^(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)$/.exec(s);
  if (m) {
    const a = Number(m[1]), b = Number(m[2]);
    return (v) => v >= Math.min(a, b) && v <= Math.max(a, b);
  }
  m = /^(\d+(?:\.\d+)?)$/.exec(s);
  if (m) {
    const n = Number(m[1]);
    return (v) => Math.abs(v - n) < 0.005;
  }
  return null;
}

export function filterExp<T extends Row>(rows: T[], q: Record<string, string | undefined>): T[] {
  const v = (k: string) => (q[k] ?? "").trim().toLowerCase();
  const gt = grossTest(q.gross ?? "");
  const exact = (a: unknown, b: string) => !b || text(a) === b;
  const has = (a: unknown, b: string) => !b || text(a).includes(b);
  return rows.filter((r) => {
    if (!exact(r.Head, v("head")) || !exact(r.Mode, v("mode")) || !exact(r["R/P"], v("rp"))) return false;
    if (!has(r.DocNo, v("doc"))) return false;
    if (v("director") && !nameOnly(r.Director).includes(v("director"))) return false;
    if (v("emp") && !nameOnly(r.Emp).includes(v("emp"))) return false;
    if (!has(r.BkgID, v("bkg")) || !has(r.Client, v("client")) || !has(r.Project, v("project")) || !has(r.Narration, v("narration"))) return false;
    if (gt && !gt(Number(r.Gross) || 0)) return false;
    const d = String(r.PayDate ?? "");
    if (v("from") && d < v("from")) return false;
    if (v("to") && d > v("to")) return false;
    return true;
  });
}
