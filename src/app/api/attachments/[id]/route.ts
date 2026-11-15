import { eq } from "drizzle-orm";
import { currentUser } from "@/lib/auth";
import { getDb, schema as s } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Download (inline for images and PDFs). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user || (user.role !== "admin" && user.role !== "master")) return new Response("Not allowed", { status: 403 });
  const id = Number((await params).id);
  const db = await getDb();
  const [a] = await db.select().from(s.expAttachments).where(eq(s.expAttachments.id, id));
  if (!a) return new Response("Not found", { status: 404 });
  const inline = /^(image\/|application\/pdf)/.test(a.mime);
  return new Response(Buffer.from(a.data, "base64"), {
    headers: {
      "Content-Type": a.mime,
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(a.filename)}`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, max-age=300",
    },
  });
}

/** Remove a file: the Master, or the person who uploaded it. */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user || (user.role !== "admin" && user.role !== "master")) return new Response("Not allowed", { status: 403 });
  const id = Number((await params).id);
  const db = await getDb();
  const [a] = await db.select({ by: s.expAttachments.uploadedBy }).from(s.expAttachments).where(eq(s.expAttachments.id, id));
  if (!a) return Response.json({ ok: true });
  if (user.role !== "master" && a.by !== user.id) return Response.json({ ok: false, message: "Only the Master or the uploader can remove this file" }, { status: 403 });
  await db.delete(s.expAttachments).where(eq(s.expAttachments.id, id));
  return Response.json({ ok: true });
}
