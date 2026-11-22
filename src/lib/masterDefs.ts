// Project, Inventory and Price List masters (TRPL): column definitions shared by the pages, the upload and the template.
export type MasterKind = "projects" | "inventory" | "pricelist";
export interface MasterCol { key: string; label: string; type: "text" | "num" | "date"; req?: boolean; aliases?: string[] }
export interface MasterDef { kind: MasterKind; title: string; blurb: string; cols: MasterCol[]; example: Record<string, string | number> }

export const MASTER_DEFS: Record<MasterKind, MasterDef> = {
  projects: {
    kind: "projects", title: "Projects",
    blurb: "The list of projects a booking can use, each with its one Builder and Location - a booking fills them in by itself when the project is chosen. A project that is not here is rejected on a booking and in an upload, so add new projects here first - by hand or by upload. A row of an upload with an existing Project corrects that project's Builder / Location.",
    cols: [
      { key: "name", label: "Project", type: "text", req: true, aliases: ["project name", "name"] },
      { key: "builder", label: "Builder", type: "text" },
      { key: "location", label: "ProjectLocation", type: "text", aliases: ["location", "project location"] },
    ],
    example: { name: "Project name", builder: "Builder name", location: "Sector, City" },
  },
  inventory: {
    kind: "inventory", title: "Inventory",
    blurb: "Units of each project with their area. A unit found here is checked against sold / on-hold units; a unit not listed is still accepted on a booking.",
    cols: [
      { key: "project", label: "Project", type: "text", req: true },
      { key: "unitNo", label: "UnitNo", type: "text", req: true, aliases: ["unit", "unit no", "unit no."] },
      { key: "area", label: "Area", type: "num", aliases: ["area (sq ft)", "sq ft"] },
    ],
    example: { project: "Project name", unitNo: "1403", area: 1000 },
  },
  pricelist: {
    kind: "pricelist", title: "Price list",
    blurb: "Price of a project for a date range. A booking dated inside the range gets BSP, other charges, payment plan and slab suggested (all stay editable on the booking). Leave DateTo blank for an open-ended row; ranges of one project must not overlap.",
    cols: [
      { key: "project", label: "Project", type: "text", req: true },
      { key: "dateFrom", label: "DateFrom", type: "date", req: true, aliases: ["from", "date from", "valid from"] },
      { key: "dateTo", label: "DateTo", type: "date", aliases: ["to", "date to", "valid to"] },
      { key: "bsp", label: "BSPPSF", type: "num", aliases: ["bsp", "bsp psf"] },
      { key: "oc", label: "OtherChargesPSF", type: "num", aliases: ["oc", "other charges", "other charges psf"] },
      { key: "paymentPlan", label: "PaymentPlan", type: "text", aliases: ["payment plan"] },
      { key: "slab", label: "DSlab", type: "num" },
      { key: "slabType", label: "DSlabType", type: "text" },
      { key: "structureDate", label: "StructureDate", type: "date", aliases: ["structure date"] },
      { key: "possessionDate", label: "PossessionDate", type: "date", aliases: ["possession date"] },
    ],
    example: { project: "Project name", dateFrom: "01-04-2026", dateTo: "", bsp: 5000, oc: 0, paymentPlan: "40-30-30", slab: 0, slabType: "", structureDate: "", possessionDate: "" },
  },
};

export const isMasterKind = (k: string): k is MasterKind => k in MASTER_DEFS;
const norm = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, "");
/** Column key for a file header (label, key or alias, ignoring case and punctuation), or null. */
export function masterKeyOfHeader(kind: MasterKind, header: string): string | null {
  const h = norm(header);
  for (const c of MASTER_DEFS[kind].cols) if ([c.key, c.label, ...(c.aliases ?? [])].some((a) => norm(a) === h)) return c.key;
  return null;
}
