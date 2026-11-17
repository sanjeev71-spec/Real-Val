import { currentUser } from "@/lib/auth";
import { bkgTemplateCsv, bkgTemplateXlsx } from "@/lib/bkgUpload";

export const dynamic = "force-dynamic";

/** Bkg upload template: ?format=xlsx (with an example row and instructions) or ?format=csv (headers only). */
export async function GET(req: Request) {
  const user = await currentUser();
  if (!user || (user.role !== "master" && user.role !== "admin")) return new Response("Admin or Master only", { status: 403 });
  if (new URL(req.url).searchParams.get("format") === "csv") {
    return new Response("\uFEFF" + bkgTemplateCsv(), {
      headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="Bkg-upload-template.csv"' },
    });
  }
  return new Response(new Uint8Array(await bkgTemplateXlsx()), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="Bkg-upload-template.xlsx"',
    },
  });
}
