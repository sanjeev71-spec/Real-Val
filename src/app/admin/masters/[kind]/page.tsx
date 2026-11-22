import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { COMPANY } from "@/lib/company";
import { MASTER_DEFS, isMasterKind } from "@/lib/masterDefs";
import { loadMasterRows, projectsSeeded } from "@/lib/masterData";
import { MasterManager } from "@/components/MasterManager";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export default async function MasterPage({ params }: { params: Promise<{ kind: string }> }) {
  await requireUser(["admin", "master"]);
  const { kind } = await params;
  if (!COMPANY.manualMasters || !isMasterKind(kind)) notFound();
  const rows = await loadMasterRows(kind);
  const canSeed = kind === "projects" && !(await projectsSeeded());
  const def = MASTER_DEFS[kind];
  return (
    <div className="space-y-4">
      <h1 className="h1">{def.title} master</h1>
      <p className="text-sm text-[var(--muted)]">{def.blurb}</p>
      <MasterManager kind={kind} cols={def.cols} rows={rows.map((r) => ({ ...r }))} canSeed={canSeed} />
    </div>
  );
}
