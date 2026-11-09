import { currentUser } from "@/lib/auth";
import { templateCsv, templateXlsx } from "@/lib/bulk";

export const dynamic = "force-dynamic";

/** Bulk-upload template: ?format=xlsx (with an example row and instructions) or ?format=csv (headers only). */
export async function GET(req: Request) {
  const user = await currentUser();
  if (!user || user.role !== "master") return new Response("Master only", { status: 403 });
  if (new URL(req.url).searchParams.get("format") === "csv") {
    return new Response("﻿" + templateCsv(), {
      headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="Bkg-upload-template.csv"' },
    });
  }
  return new Response(new Uint8Array(await templateXlsx()), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="Bkg-upload-template.xlsx"',
    },
  });
}
