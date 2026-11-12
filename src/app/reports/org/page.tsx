import { requireUser } from "@/lib/auth";
import { orgNodes, partners } from "@/lib/data";
import { OrgChart } from "@/components/OrgChart";

export const dynamic = "force-dynamic";

export default async function OrgPage() {
  await requireUser(["master", "admin", "hr"]);
  const [nodes, p] = await Promise.all([orgNodes(), partners()]);
  return (
    <div className="space-y-4">
      <h1 className="h1">Org</h1>
      <OrgChart nodes={nodes} partners={p} />
    </div>
  );
}
