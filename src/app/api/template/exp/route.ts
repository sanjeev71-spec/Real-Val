import { currentUser } from "@/lib/auth";
import { expTemplateCsv, expTemplateXlsx } from "@/lib/bulkExp";

export const dynamic = "force-dynamic";

/** Exp bulk-upload template: ?format=xlsx (example rows and instructions) or ?format=csv (headers only). */
export async function GET(req: Request) {
  const user = await currentUser();
  if (!user || user.role !== "master") return new Response("Master only", { status: 403 });
  if (new URL(req.url).searchParams.get("format") === "csv") {
    return new Response("﻿" + expTemplateCsv(), {
      headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="Exp-upload-template.csv"' },
    });
  }
  return new Response(new Uint8Array(await expTemplateXlsx()), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="Exp-upload-template.xlsx"',
    },
  });
}
