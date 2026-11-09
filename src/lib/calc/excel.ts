// Small helpers that reproduce Excel semantics the Bkg formulas depend on.

export type Cell = string | number | boolean | null | undefined;

/** Excel N(): numbers pass through, everything else is 0. */
export function N(x: Cell): number {
  return typeof x === "number" && Number.isFinite(x) ? x : 0;
}

/** Value used in arithmetic: blank -> 0, numeric text -> number. */
export function num(x: Cell): number {
  if (typeof x === "number") return Number.isFinite(x) ? x : 0;
  if (typeof x === "string") {
    const t = x.replace(/,/g, "").trim();
    if (t === "") return 0;
    const v = Number(t);
    return Number.isFinite(v) ? v : 0;
  }
  return 0;
}

/** Excel ROUND: half away from zero. */
export function round(x: number, digits = 0): number {
  const f = 10 ** digits;
  const r = (Math.sign(x) * Math.round(Math.abs(x) * f * (1 + Number.EPSILON))) / f;
  return r === 0 ? 0 : r; // avoid -0
}

/** Text form of a cell, trimmed ("" for blank). */
export function str(x: Cell): string {
  if (x === null || x === undefined) return "";
  return String(x).trim();
}

/** Excel "=" on text is case-insensitive. */
export function eq(a: Cell, b: Cell): boolean {
  return str(a).toLowerCase() === str(b).toLowerCase();
}

/** CodeOf: text after "~", or "" when there is no "~". */
export function codeOf(x: Cell): string {
  const s = str(x);
  const i = s.indexOf("~");
  return i < 0 ? "" : s.slice(i + 1);
}

/** Excel date serial <-> ISO date (yyyy-mm-dd). */
const EPOCH = Date.UTC(1899, 11, 30);
export function isoToSerial(iso: Cell): number | null {
  if (typeof iso === "number") return iso;
  const s = str(iso);
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (!m) return null;
  return Math.round((Date.UTC(+m[1], +m[2] - 1, +m[3]) - EPOCH) / 86400000);
}
export function serialToIso(serial: number | null | undefined): string | null {
  if (serial === null || serial === undefined || !Number.isFinite(serial)) return null;
  const d = new Date(EPOCH + Math.round(serial) * 86400000);
  return d.toISOString().slice(0, 10);
}
