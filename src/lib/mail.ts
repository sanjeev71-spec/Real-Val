import "server-only";
import nodemailer from "nodemailer";

export interface Mail {
  to: string | string[];
  cc?: string | string[];
  replyTo?: string;
  subject: string;
  html: string;
}

let transport: ReturnType<typeof nodemailer.createTransport> | null = null;

/**
 * Sends through the no-reply Gmail account (GMAIL_USER + GMAIL_APP_PASSWORD).
 * Without those variables (local development) the email is printed to the console instead.
 */
export async function sendMail(m: Mail): Promise<void> {
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  const to = [m.to].flat().filter(Boolean);
  if (!to.length) return;
  if (!user || !pass) {
    console.log(`\n[mail:dev] to=${to.join(",")} cc=${[m.cc ?? []].flat().join(",")} subject="${m.subject}"\n${m.html.replace(/<a href="([^"]+)">/g, " [$1] ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()}\n`);
    return;
  }
  transport ??= nodemailer.createTransport({ service: "gmail", auth: { user, pass } });
  await transport.sendMail({
    from: `"Realty Vault (no-reply)" <${user}>`,
    to,
    cc: m.cc,
    replyTo: m.replyTo ?? process.env.MASTER_EMAIL ?? undefined,
    subject: m.subject,
    html: `${m.html}<hr><p style="color:#888;font-size:12px">Automated message from the Realty Vault booking system. Please do not reply to this address.</p>`,
  });
}

const baseUrl = () =>
  process.env.APP_URL ??
  (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : `http://localhost:${process.env.PORT ?? 3000}`);
export const appUrl = (path = "") => `${baseUrl().replace(/\/$/, "")}${path}`;
