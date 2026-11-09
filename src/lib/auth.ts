import "server-only";
import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { and, desc, eq, gt, isNull } from "drizzle-orm";
import { jwtVerify, SignJWT } from "jose";
import { getDb, schema as s } from "./db";
import { sendMail } from "./mail";

const COOKIE = "rv_session";
const SESSION_HOURS = 12;
const OTP_MINUTES = 10;
const OTP_MAX_ATTEMPTS = 5;
const OTP_RESEND_SECONDS = 60;

function secret(): string {
  const v = process.env.SESSION_SECRET;
  if (v && v.length >= 32) return v;
  if (process.env.NODE_ENV === "production") throw new Error("SESSION_SECRET must be set (32+ characters)");
  return "dev-only-secret-change-me-dev-only-secret";
}
const key = () => new TextEncoder().encode(secret());
const hashOtp = (email: string, code: string) => createHmac("sha256", secret()).update(`${email}:${code}`).digest("hex");

export type Role = "master" | "admin" | "sales";
export type User = typeof s.users.$inferSelect;

export const normEmail = (e: string) => e.trim().toLowerCase();

/** Sends a 6-digit sign-in code if the email belongs to an active user. Always reports success to avoid revealing who has access. */
export async function requestOtp(emailRaw: string): Promise<void> {
  const email = normEmail(emailRaw);
  const db = await getDb();
  const [user] = await db.select().from(s.users).where(and(eq(s.users.email, email), eq(s.users.active, true)));
  if (!user) return;
  const [recent] = await db
    .select()
    .from(s.otpCodes)
    .where(and(eq(s.otpCodes.email, email), gt(s.otpCodes.createdAt, new Date(Date.now() - OTP_RESEND_SECONDS * 1000))));
  if (recent) return; // throttle
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  await db.insert(s.otpCodes).values({
    email,
    codeHash: hashOtp(email, code),
    expiresAt: new Date(Date.now() + OTP_MINUTES * 60_000),
  });
  await sendMail({
    to: email,
    subject: `Your Realty Vault sign-in code: ${code}`,
    html: `<p>Hello ${user.name},</p><p>Your sign-in code is <b style="font-size:20px;letter-spacing:3px">${code}</b>.</p>
      <p>It expires in ${OTP_MINUTES} minutes. If you did not try to sign in, ignore this email.</p>`,
  });
}

export async function verifyOtp(emailRaw: string, codeRaw: string): Promise<boolean> {
  const email = normEmail(emailRaw);
  const code = codeRaw.replace(/\D/g, "");
  const db = await getDb();
  const [otp] = await db
    .select()
    .from(s.otpCodes)
    .where(and(eq(s.otpCodes.email, email), isNull(s.otpCodes.consumedAt), gt(s.otpCodes.expiresAt, new Date())))
    .orderBy(desc(s.otpCodes.createdAt))
    .limit(1);
  if (!otp || otp.attempts >= OTP_MAX_ATTEMPTS) return false;
  const a = Buffer.from(otp.codeHash, "hex");
  const b = Buffer.from(hashOtp(email, code), "hex");
  if (code.length !== 6 || !timingSafeEqual(a, b)) {
    await db.update(s.otpCodes).set({ attempts: otp.attempts + 1 }).where(eq(s.otpCodes.id, otp.id));
    return false;
  }
  await db.update(s.otpCodes).set({ consumedAt: new Date() }).where(eq(s.otpCodes.id, otp.id));
  const [user] = await db.select().from(s.users).where(and(eq(s.users.email, email), eq(s.users.active, true)));
  if (!user) return false;
  const token = await new SignJWT({ uid: user.id })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_HOURS}h`)
    .sign(key());
  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_HOURS * 3600,
  });
  return true;
}

export async function signOut() {
  (await cookies()).delete(COOKIE);
}

export async function currentUser(): Promise<User | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, key());
    const db = await getDb();
    const [u] = await db.select().from(s.users).where(eq(s.users.id, Number(payload.uid)));
    return u && u.active ? u : null;
  } catch {
    return null;
  }
}

export async function requireUser(roles?: Role[]): Promise<User> {
  const u = await currentUser();
  if (!u) redirect("/login");
  if (roles && !roles.includes(u.role)) redirect("/");
  return u;
}
