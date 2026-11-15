// Exp documents: one transaction can have many lines, numbered BASE-01, BASE-02... (e.g. NOC-0419-01 .. NOC-0419-30).
// A line without a suffix is a one-line document whose base is the whole DocNo.

/** "NOC-0419-07" -> { base: "NOC-0419", line: 7 }; "Sac-1860" -> { base: "Sac-1860", line: null }. */
export function splitDocNo(docNo: string | null | undefined): { base: string | null; line: number | null } {
  const s = (docNo ?? "").trim();
  if (!s) return { base: null, line: null };
  const m = /^(.+-[^-]+)-(\d{1,3})[A-Z]?$/.exec(s); // at least two dashes: BASE-NN
  return m ? { base: m[1], line: parseInt(m[2], 10) } : { base: s, line: null };
}

export const lineDocNo = (base: string, line: number) => `${base}-${String(line).padStart(2, "0")}`;

/** A base number a person may type: letters, digits and - _ . / only. */
export const validDocBase = (s: string) => /^[A-Za-z0-9][A-Za-z0-9._/-]{1,39}$/.test(s);
