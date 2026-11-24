import "server-only";
import { pnlDirectorInfo, todayIso } from "./data";
import { dashRows } from "./dashData";
import { isoToSerial } from "./calc/excel";
import { BY_LABEL, type By, type Scope } from "./calc/dashScope";

type Q = { from?: string; to?: string; director?: string; builder?: string; project?: string; by?: string };
const isoOk = (v?: string) => /^\d{4}-\d{2}-\d{2}$/.test(v ?? "");

/** The period (default: this year up to today), the Director / Builder / Project picked, and the lists for the pickers. */
export async function dashContext(q: Q) {
  const today = todayIso();
  const fromIso = isoOk(q.from) ? q.from! : `${today.slice(0, 4)}-01-01`;
  const toIso = isoOk(q.to) ? q.to! : today;
  const { bks, exps } = await dashRows();
  const directors = await pnlDirectorInfo();
  const scope: Scope = { director: q.director ?? "", builder: q.builder ?? "", project: q.project ?? "" };
  const by: By = (["director", "builder", "project", "branch"] as const).includes(q.by as By) ? (q.by as By) : "director";
  const builders = [...new Set(bks.map((b) => b.builder.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const pm = new Map<string, string>();
  for (const b of bks) if (b.project.trim() && !pm.has(b.project.trim())) pm.set(b.project.trim(), b.builder.trim());
  const projects = [...pm.entries()].map(([name, builder]) => ({ name, builder })).sort((a, b) => a.name.localeCompare(b.name));
  const label = [scope.director && scope.director.split("~")[0], scope.builder, scope.project].filter(Boolean).join(" · ") || "Entire company";
  const params = { from: fromIso, to: toIso, ...scope, by };
  /** The dashboard's own link with some picks changed (empty string removes a pick). */
  const href = (path: string, over: Partial<Record<string, string>> = {}) => {
    const m: Record<string, string> = { ...params, ...over };
    const qs = new URLSearchParams(Object.entries(m).filter(([, v]) => v));
    return `${path}?${qs.toString()}`;
  };
  return { today, fromIso, toIso, from: isoToSerial(fromIso)!, to: isoToSerial(toIso)!, bks, exps, directors, builders, projects, scope, by, byLabel: BY_LABEL[by], label, params, href };
}
