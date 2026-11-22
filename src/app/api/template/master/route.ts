import { currentUser } from "@/lib/auth";
import { masterCsv, masterXlsx } from "@/lib/masterData";
import { isMasterKind } from "@/lib/masterDefs";

export const dynamic = "force-dynamic";

/** ?kind=projects|inventory|pricelist &format=xlsx|csv &data=1 (xlsx with the current rows, to correct and upload again). */
export async function GET(req: Request) {
  const user = await currentUser();
  if (!user || (user.role !== "master" && user.role !== "admin")) return new Response("Admin or Master only", { status: 403 });
  const q = new URL(req.url).searchParams;
  const kind = q.get("kind") ?? "";
  if (!isMasterKind(kind)) return new Response("Unknown master", { status: 400 });
  if (q.get("format") === "csv") {
    return new Response("﻿" + masterCsv(kind), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${kind}-template.csv"` } });
  }
  const withData = q.get("data") === "1";
  return new Response(new Uint8Array(await masterXlsx(kind, withData)), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${kind}-${withData ? "current" : "template"}.xlsx"`,
    },
  });
}
