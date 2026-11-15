import { currentUser } from "@/lib/auth";
import { getDb, schema as s } from "@/lib/db";
import { docLines } from "@/lib/changes";
import { bumpData } from "@/lib/cache";

export const dynamic = "force-dynamic";

const MAX_ATTACHMENT = 3_000_000; // 3 MB per file
const OK_EXT = /\.(pdf|png|jpe?g|webp|gif|xlsx?|docx?|csv|txt)$/i;

/** Upload one file to an existing Exp document (Admin or Master). multipart: base, file */
export async function POST(req: Request) {
  const user = await currentUser();
  if (!user || (user.role !== "admin" && user.role !== "master")) return new Response("Not allowed", { status: 403 });
  const form = await req.formData();
  const base = String(form.get("base") ?? "").trim();
  const f = form.get("file");
  if (!base || !(f instanceof File) || f.size === 0) return Response.json({ ok: false, message: "Choose a file" }, { status: 400 });
  if (f.size > MAX_ATTACHMENT) return Response.json({ ok: false, message: "A file can be up to 3 MB" }, { status: 400 });
  if (!OK_EXT.test(f.name)) return Response.json({ ok: false, message: "Allowed: PDF, images, Excel, Word, CSV, text" }, { status: 400 });
  const db = await getDb();
  if (!(await docLines(db, base)).length) return Response.json({ ok: false, message: "Document not found" }, { status: 404 });
  const data = Buffer.from(await f.arrayBuffer()).toString("base64");
  const [row] = await db.insert(s.expAttachments).values({
    docBase: base, filename: f.name.slice(0, 200), mime: f.type || "application/octet-stream", size: f.size, data, uploadedBy: user.id,
  }).returning({ id: s.expAttachments.id });
  bumpData();
  return Response.json({ ok: true, id: row.id });
}

