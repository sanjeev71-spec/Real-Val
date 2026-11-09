// Loads data/excel/*.json (made by scripts/export-excel.ps1) into the database.
//   npm run import:excel                 -> refresh masters, Emp and Exp; add bookings not yet in the DB
//   npm run import:excel -- --masters-only  -> refresh masters, Emp and Exp only
// Masters, Emp and Exp are replaced wholesale (Excel stays their source of truth for now).
// Existing bookings are never overwritten.
import "./load-env";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { getDb, schema as s } from "../src/lib/db";
import { serialToIso, str, num } from "../src/lib/calc/excel";
import { BKG_INPUT_KEYS, DATE_KEYS } from "../src/lib/fields";

type J = Record<string, string | number | null>;
const dir = join(process.cwd(), "data", "excel");
const load = (n: string): J[] => {
  const f = join(dir, `${n}.json`);
  if (!existsSync(f)) throw new Error(`missing ${f} — run scripts/export-excel.ps1 first`);
  const v = JSON.parse(readFileSync(f, "utf8"));
  return Array.isArray(v) ? v : [v];
};
const d = (x: string | number | null) => (typeof x === "number" ? serialToIso(x) : str(x) || null);
const n = (x: string | number | null) => (x === null || str(x) === "" ? null : num(x));
const t = (x: string | number | null) => (str(x) === "" ? null : str(x));

async function main() {
  const mastersOnly = process.argv.includes("--masters-only");
  const db = await getDb();

  await db.transaction(async (tx) => {
    await tx.delete(s.employees);
    const emp = load("Emp").filter((r) => str(r.Emp) !== "");
    if (emp.length)
      await tx.insert(s.employees).values(
        emp.map((r, i) => ({
          seq: i,
          emp: str(r.Emp),
          reportingHead: str(r.ReportingHead),
          revShare: n(r.RevShare),
          expShare: n(r.ExpShare),
          branch: t(r.Branch),
          status: t(r.Status),
          type: t(r.Type),
          designation: t(r.Designation),
          email: t(r["Personal Mail ID"]),
          changeDateFrom: d(r.ChangeDateFrom)!,
          changeDateTo: d(r.ChangeDateTo)!,
        })),
      );

    await tx.delete(s.expEntries);
    const exp = load("Exp");
    if (exp.length)
      await tx.insert(s.expEntries).values(
        exp.map((r) => ({
          docNo: t(r.DocNo), payDate: d(r.PayDate), valueDate: d(r.ValueDate), head: t(r.Head), mode: t(r.Mode),
          rp: t(r["R/P"]), gross: n(r.Gross), gst: n(r.GST), tds: n(r.TDS), branch: t(r.Branch), bkgId: t(r.BkgID),
          project: t(r.Project), narration: t(r.Narration), remarks: t(r.Remarks),
        })),
      );

    await tx.delete(s.projects);
    const proj = load("Project").filter((r) => str(r.Project) !== "");
    if (proj.length)
      await tx.insert(s.projects).values(proj.map((r) => ({ name: str(r.Project), location: t(r["Project Location"]), builder: t(r.Builder) })));

    await tx.delete(s.inventory);
    const inv = load("Inventory").filter((r) => str(r.Project) !== "" && str(r.UnitNo) !== "");
    if (inv.length)
      await tx.insert(s.inventory).values(inv.map((r) => ({ project: str(r.Project), unitNo: str(r.UnitNo), area: n(r.Area) })));

    await tx.delete(s.priceList);
    const pl = load("PriceList").filter((r) => str(r.Project) !== "");
    const today = new Date().toISOString().slice(0, 10);
    if (pl.length)
      await tx.insert(s.priceList).values(
        pl.map((r) => {
          const to = d(r.DateTo);
          return {
            project: str(r.Project), dateFrom: d(r.DateFrom)!,
            dateTo: to === today ? null : to, // Excel's =TODAY() means "open-ended"
            bsp: n(r.BSP), oc: n(r.OC), paymentPlan: t(r.PaymentPlan), slab: n(r.Slab), slabType: t(r.SlabType),
            structureDate: d(r.Structure), possessionDate: d(r.Possession),
          };
        }),
      );

    await tx.delete(s.rcRa);
    const rc = load("RCRAMaster").filter((r) => str(r["RC/RA"]) !== "");
    if (rc.length) await tx.insert(s.rcRa).values(rc.map((r) => ({ name: str(r["RC/RA"]), rc: n(r["RC%"]), ra: n(r["RA%"]) })));

    await tx.delete(s.expHeads);
    const eh = load("ExpType").filter((r) => str(r.ExpHead) !== "");
    if (eh.length) await tx.insert(s.expHeads).values(eh.map((r) => ({ head: str(r.ExpHead), type: t(r.ExpType) })));

    await tx.delete(s.overrideRules);
    const ov = load("OverrideRules").filter((r) => str(r.OverrideEmployee) !== "");
    if (ov.length)
      await tx.insert(s.overrideRules).values(
        ov.map((r) => ({
          overrideEmployee: str(r.OverrideEmployee), sharePct: n(r["Share%"]), branch: t(r.Branch),
          excludeDirector: t(r.ExcludeDirector), effectiveFrom: d(r.EffectiveFrom), effectiveTo: d(r.EffectiveTo),
          active: t(r.Active), targetDirector: t(r.TargetDirector), targetDownline: t(r.TargetDownline),
        })),
      );
  });
  console.log("masters, Emp and Exp refreshed");

  if (!mastersOnly) {
    const bkg = load("Bkg").filter((r) => str(r.BkgID) !== "");
    let added = 0;
    for (const r of bkg) {
      const data: Record<string, string | number | null> = {};
      for (const k of BKG_INPUT_KEYS) {
        const v = r[k] ?? null;
        data[k] = DATE_KEYS.has(k) ? d(v) : v;
      }
      if (data.UnitNo !== null) data.UnitNo = str(data.UnitNo);
      const res = await db
        .insert(s.bookings)
        .values({ bkgId: str(r.BkgID), data, source: "excel" })
        .onConflictDoNothing({ target: s.bookings.bkgId })
        .returning({ id: s.bookings.id });
      added += res.length;
    }
    console.log(`bookings: ${added} added, ${bkg.length - added} already present`);
  }

  const master = (process.env.MASTER_EMAIL ?? "sanjeev71@gmail.com").toLowerCase();
  await db.execute(sql`insert into users (email, name, role) values (${master}, 'Sanjeev Tandon', 'master') on conflict (email) do nothing`);
  console.log(`master user: ${master}`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
